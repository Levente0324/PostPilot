"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPaidAccess, resolvePlanFromPriceId } from "@/lib/subscription";
import { redirect } from "next/navigation";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-01-28.clover",
    });
  }
  return stripeClient;
}

/** Returns true if this is a Stripe "resource not found" error (e.g. stale test/live customer ID). */
function isStripeNotFoundError(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    err.code === "resource_missing"
  );
}

async function getCurrentUserAndProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, stripe_customer_id, plan, subscription_status")
    .eq("id", user.id)
    .single();

  return { supabase, user, profile };
}

/**
 * Returns the Stripe customer ID for the current user.
 * If the stored ID is stale (wrong mode / deleted in Stripe), clears it and creates a fresh customer.
 */
async function getOrCreateCustomerId() {
  const { supabase, user, profile } = await getCurrentUserAndProfile();
  const stripe = getStripe();

  if (profile?.stripe_customer_id) {
    // Validate the stored customer actually exists in Stripe before using it.
    try {
      const existing = await stripe.customers.retrieve(
        profile.stripe_customer_id,
      );
      if (!("deleted" in existing)) {
        // Customer is valid — use it.
        return { customerId: profile.stripe_customer_id, user, profile };
      }
      // Customer was deleted in Stripe — fall through to create a new one.
    } catch (err) {
      if (!isStripeNotFoundError(err)) throw err;
      // Stale / wrong-mode customer ID — fall through to create a new one.
    }

    // Clear the stale ID from the DB before creating a fresh customer.
    // Use admin client — column-level REVOKE blocks authenticated role from writing billing columns.
    const adminForClear = createAdminClient();
    await adminForClear
      .from("profiles")
      .update({ stripe_customer_id: null })
      .eq("id", user.id);
  }

  // Create a new Stripe customer.
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { supabaseUUID: user.id },
  });

  // Use admin client — column-level REVOKE blocks authenticated role from writing billing columns.
  const adminForLink = createAdminClient();
  await adminForLink
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  return { customerId: customer.id, user, profile };
}

function isActiveSubscriptionStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

/**
 * Creates a Stripe checkout session for the given plan.
 * Accepts plan as form data: "pro" or "elite".
 * If the user already has a paid plan and wants a DIFFERENT tier,
 * we update their existing subscription in-place (no double subscription).
 * If they're already on the same plan, redirect to the portal.
 */
export async function createStripeCheckoutSession(formData?: FormData) {
  const stripe = getStripe();
  const appUrl = getRequiredEnv("APP_URL");
  const { customerId, user, profile } = await getOrCreateCustomerId();

  const requestedPlan = (formData?.get("plan") as string | null) ?? "pro";

  // Determine the target price ID
  let targetPriceId: string;
  if (requestedPlan === "elite") {
    targetPriceId = process.env.STRIPE_ELITE_PRICE_ID || "";
    if (!targetPriceId) {
      throw new Error(
        "STRIPE_ELITE_PRICE_ID is not configured. Please add it to your .env.local after creating the Elite product in Stripe.",
      );
    }
  } else {
    targetPriceId = getRequiredEnv("STRIPE_PRO_PRICE_ID");
  }

  if (hasPaidAccess(profile ?? null)) {
    // User already has an active paid plan.
    // If they're already on the requested plan, send them to the portal to manage.
    if (profile?.plan === requestedPlan) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appUrl}/dashboard/account-billing`,
      });
      if (!session.url)
        throw new Error("Stripe portal session did not return a URL.");
      redirect(session.url);
    }

    // They want a DIFFERENT plan — update their existing subscription in-place.
    // This avoids creating a second subscription (bugs #9 and #10).
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    const activeSub = subscriptions.data[0];
    if (activeSub) {
      await stripe.subscriptions.update(activeSub.id, {
        items: [
          {
            id: activeSub.items.data[0].id,
            price: targetPriceId,
          },
        ],
        proration_behavior: "always_invoice",
      });

      // Immediately update the DB so the redirected page shows the correct plan.
      // The webhook will also fire and set the same values (idempotent).
      const planLimits: Record<string, number> = { pro: 20, elite: 50 };
      const adminForUpgrade = createAdminClient();
      await adminForUpgrade
        .from("profiles")
        .update({
          plan: requestedPlan,
          monthly_post_limit: planLimits[requestedPlan] ?? 3,
          subscription_status: "active",
        })
        .eq("id", user.id);

      redirect(`${appUrl}/dashboard/account-billing?upgrade=success`);
    }

    // Edge case: no active subscription found despite hasPaidAccess — fall back to portal.
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard/account-billing`,
    });
    if (!portalSession.url)
      throw new Error("Stripe portal session did not return a URL.");
    redirect(portalSession.url);
  }

  // Free user — create a new checkout session.
  // Belt-and-suspenders: also check Stripe directly for existing active subscriptions
  // in case the DB is stale (e.g. webhook hasn't processed yet from a prior checkout).
  const existingSubs = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 1,
  });
  if (existingSubs.data.length > 0) {
    // Customer already has an active subscription in Stripe — redirect to portal
    // instead of creating a duplicate subscription.
    const portalFallback = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard/account-billing`,
    });
    if (!portalFallback.url)
      throw new Error("Stripe portal session did not return a URL.");
    redirect(portalFallback.url);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    metadata: {
      supabaseUUID: user.id,
    },
    subscription_data: {
      metadata: {
        supabaseUUID: user.id,
      },
    },
    line_items: [{ price: targetPriceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/account-billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard/account-billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe checkout session did not return a URL.");
  }

  redirect(session.url);
}

export async function syncStripeCheckoutSession(sessionId: string) {
  const stripe = getStripe();
  const { supabase, user } = await getCurrentUserAndProfile();

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  if (session.mode !== "subscription" || session.status !== "complete") {
    return { ok: false, reason: "session_not_complete" as const };
  }

  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return { ok: false, reason: "payment_not_captured" as const };
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  if (!customerId) {
    return { ok: false, reason: "missing_customer" as const };
  }

  const subscription =
    typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : (session.subscription as Stripe.Subscription | null);

  const subscriptionStatus = subscription?.status ?? "incomplete";

  const sessionOwnerId =
    session.metadata?.supabaseUUID ??
    session.client_reference_id ??
    (subscription && "metadata" in subscription
      ? (subscription.metadata?.supabaseUUID ?? null)
      : null);

  let customerOwnerId: string | null = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !("deleted" in customer)) {
      customerOwnerId = customer.metadata?.supabaseUUID ?? null;
    }
  } catch (err) {
    if (!isStripeNotFoundError(err)) throw err;
    // Stale customer — ownership falls back to sessionOwnerId check below.
  }

  const ownerMatches =
    sessionOwnerId === user.id ||
    customerOwnerId === user.id ||
    (!!profile?.stripe_customer_id &&
      profile.stripe_customer_id === customerId);

  if (!ownerMatches) {
    return { ok: false, reason: "session_not_owned_by_user" as const };
  }

  // Use admin client for billing column writes — column-level REVOKE blocks
  // the authenticated role from writing plan/subscription_status/monthly_post_limit/stripe_customer_id.
  const adminForSync = createAdminClient();

  if (!isActiveSubscriptionStatus(subscriptionStatus)) {
    await adminForSync
      .from("profiles")
      .update({
        stripe_customer_id: customerId,
        subscription_status: subscriptionStatus,
        plan: "free",
        monthly_post_limit: 3,
      })
      .eq("id", user.id);

    return { ok: false, reason: "subscription_not_active" as const };
  }

  // Resolve plan from the subscription's price ID.
  const priceId = subscription?.items?.data?.[0]?.price?.id ?? "";
  const resolved = resolvePlanFromPriceId(priceId);

  await adminForSync
    .from("profiles")
    .update({
      stripe_customer_id: customerId,
      subscription_status: subscriptionStatus,
      plan: resolved.plan,
      monthly_post_limit: resolved.limit,
    })
    .eq("id", user.id);

  return { ok: true as const };
}

/**
 * Opens the Stripe billing portal for the current user.
 * Only available to users with an active paid subscription.
 * Gracefully handles stale customer IDs (test/live mode mismatch).
 */
export async function createStripePortalSession() {
  const stripe = getStripe();
  const appUrl = getRequiredEnv("APP_URL");
  const { supabase, user, profile } = await getCurrentUserAndProfile();

  // Guard: only paid users should access the portal.
  if (!hasPaidAccess(profile ?? null)) {
    redirect("/dashboard/account-billing");
  }

  const { customerId } = await getOrCreateCustomerId();

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard/account-billing`,
    });

    if (!session.url) {
      throw new Error("Stripe portal session did not return a URL.");
    }

    redirect(session.url);
  } catch (err) {
    if (!isStripeNotFoundError(err)) throw err;

    // The stored customer no longer exists in Stripe (mode mismatch or deleted).
    // Clear the stale ID, create a new customer, and re-open the portal.
    // Use admin client — column-level REVOKE blocks authenticated role from writing billing columns.
    const adminForPortalReset = createAdminClient();
    await adminForPortalReset
      .from("profiles")
      .update({
        stripe_customer_id: null,
        plan: "free",
        monthly_post_limit: 3,
        subscription_status: "inactive",
      })
      .eq("id", user.id);

    redirect("/dashboard/account-billing?billing_error=customer_missing");
  }
}

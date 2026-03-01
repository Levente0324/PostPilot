import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { resolvePlanFromPriceId } from "@/lib/subscription";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

function getSupabaseAdmin() {
  return createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

function isActiveStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

function shouldForceFree(status: string | null | undefined) {
  return (
    status === "canceled" ||
    status === "unpaid" ||
    status === "incomplete_expired"
  );
}

async function registerWebhookEvent(event: Stripe.Event) {
  const supabaseAdmin = getSupabaseAdmin();

  // Check if we've already processed this event (idempotency guard)
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing) {
    return { shouldProcess: false };
  }

  // Don't insert yet — we insert AFTER successful processing to avoid
  // permanently skipping events that fail mid-processing on retry.
  return { shouldProcess: true };
}

async function markWebhookEventProcessed(event: Stripe.Event) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
  });

  // If duplicate key (23505), another concurrent handler already marked it — fine.
  // If table missing (42P01), continue without idempotency table.
  if (error && error.code !== "23505" && error.code !== "42P01") {
    console.error("Failed to mark webhook event as processed:", error);
  }
}

async function findProfileIdByCustomerId(customerId: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return profile?.id ?? null;
}

async function linkCustomerToProfile(customerId: string, profileId: string) {
  const supabaseAdmin = getSupabaseAdmin();

  await supabaseAdmin
    .from("profiles")
    .update({ stripe_customer_id: customerId })
    .eq("id", profileId);
}

async function findProfileIdByEmail(email: string | null | undefined) {
  if (!email) return null;

  const supabaseAdmin = getSupabaseAdmin();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  return profile?.id ?? null;
}

async function resolveProfileId(params: {
  stripe: Stripe;
  customerId?: string | null;
  supabaseUUID?: string | null;
  email?: string | null;
}) {
  const { stripe, customerId, supabaseUUID, email } = params;

  if (supabaseUUID) {
    if (customerId) {
      await linkCustomerToProfile(customerId, supabaseUUID);
    }
    return supabaseUUID;
  }

  if (customerId) {
    const found = await findProfileIdByCustomerId(customerId);
    if (found) return found;

    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !("deleted" in customer)) {
      const metadataUUID = customer.metadata?.supabaseUUID;
      if (metadataUUID) {
        await linkCustomerToProfile(customerId, metadataUUID);
        return metadataUUID;
      }

      const profileByEmail = await findProfileIdByEmail(customer.email);
      if (profileByEmail) {
        await linkCustomerToProfile(customerId, profileByEmail);
        return profileByEmail;
      }
    }
  }

  const profileByEmail = await findProfileIdByEmail(email);
  if (profileByEmail) return profileByEmail;

  return null;
}

/**
 * Trims the user's scheduled posts so that at most `keepCount` remain.
 * Always keeps the N posts closest to today (ascending order), deletes the rest.
 * This implements smart downgrade cleanup (#16).
 */
async function trimScheduledPostsToLimit(profileId: string, keepCount: number) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: scheduledRows } = await supabaseAdmin
    .from("scheduled_posts")
    .select("id, post_id, scheduled_for, posts!inner(user_id)")
    .eq("posts.user_id", profileId)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true }); // closest first

  const all = (scheduledRows ?? []) as any[];
  if (all.length <= keepCount) return; // nothing to remove

  const toRemove = all.slice(keepCount); // everything beyond the limit
  const postIds = toRemove.map((r: any) => r.post_id);

  if (postIds.length > 0) {
    await supabaseAdmin.from("posts").delete().in("id", postIds);
  }
}

/**
 * Marks a profile as paid (pro or elite) based on the subscription's price ID.
 * Also trims excess scheduled posts when downgrading tiers.
 */
async function markPaidByProfileId(
  profileId: string,
  subscriptionStatus: string,
  priceId: string,
) {
  const supabaseAdmin = getSupabaseAdmin();
  const resolved = resolvePlanFromPriceId(priceId);

  await supabaseAdmin
    .from("profiles")
    .update({
      subscription_status: subscriptionStatus,
      plan: resolved.plan,
      monthly_post_limit: resolved.limit,
    })
    .eq("id", profileId);

  // Trim excess posts to fit the new plan limit (handles downgrades like elite→pro)
  await trimScheduledPostsToLimit(profileId, resolved.limit);
}

async function updateSubscriptionStatusOnly(
  profileId: string,
  subscriptionStatus: string,
) {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: subscriptionStatus })
    .eq("id", profileId);
}

async function markFreeAndClearPostsByProfileId(
  profileId: string,
  subscriptionStatus: string = "inactive",
) {
  const supabaseAdmin = getSupabaseAdmin();

  // Smart cleanup: keep the 3 closest scheduled posts (free tier limit).
  // This is better than deleting everything — users keep their most imminent posts.
  await trimScheduledPostsToLimit(profileId, 3);

  await supabaseAdmin
    .from("profiles")
    .update({
      subscription_status: subscriptionStatus,
      plan: "free",
      monthly_post_limit: 3,
    })
    .eq("id", profileId);
}

/**
 * Extracts the first price ID from a Stripe subscription object.
 */
function extractPriceId(subscription: Stripe.Subscription): string {
  return subscription.items?.data?.[0]?.price?.id ?? "";
}

async function getSubscriptionStatusFromSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (typeof session.subscription !== "string") {
    return { status: "incomplete", priceId: "" };
  }

  const subscription = await stripe.subscriptions.retrieve(
    session.subscription,
  );
  return { status: subscription.status, priceId: extractPriceId(subscription) };
}

export async function POST(req: Request) {
  try {
    const stripe = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-01-28.clover",
    });

    const body = await req.text();
    const signature = (await headers()).get("stripe-signature");
    const webhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");

    if (!signature) {
      return new NextResponse("Missing stripe-signature header", {
        status: 400,
      });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (error: any) {
      console.error("Stripe webhook signature error:", error.message);
      return new NextResponse("Invalid signature", {
        status: 400,
      });
    }

    const dedupe = await registerWebhookEvent(event);
    if (!dedupe.shouldProcess) {
      return new NextResponse(null, { status: 200 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const profileId = await resolveProfileId({
          stripe,
          customerId:
            typeof session.customer === "string" ? session.customer : null,
          supabaseUUID:
            session.metadata?.supabaseUUID ?? session.client_reference_id,
          email: session.customer_details?.email,
        });

        if (!profileId) {
          console.error(
            "checkout.session.completed: could not resolve profile",
            {
              customer: session.customer,
              clientReferenceId: session.client_reference_id,
            },
          );
          break;
        }

        const { status, priceId } = await getSubscriptionStatusFromSession(
          stripe,
          session,
        );
        if (isActiveStatus(status)) {
          await markPaidByProfileId(profileId, status, priceId);
        } else if (shouldForceFree(status)) {
          await markFreeAndClearPostsByProfileId(profileId, status);
        } else {
          await updateSubscriptionStatusOnly(profileId, status);
        }

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = extractPriceId(subscription);

        const profileId = await resolveProfileId({
          stripe,
          customerId,
          supabaseUUID: subscription.metadata?.supabaseUUID,
        });

        if (!profileId) {
          console.error(`${event.type}: could not resolve profile`, {
            customerId,
          });
          break;
        }

        if (isActiveStatus(subscription.status)) {
          await markPaidByProfileId(profileId, subscription.status, priceId);
        } else if (shouldForceFree(subscription.status)) {
          await markFreeAndClearPostsByProfileId(
            profileId,
            subscription.status,
          );
        } else {
          await updateSubscriptionStatusOnly(profileId, subscription.status);
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const profileId = await resolveProfileId({
          stripe,
          customerId,
          supabaseUUID: subscription.metadata?.supabaseUUID,
        });

        if (!profileId) {
          console.error(
            "customer.subscription.deleted: could not resolve profile",
            {
              customerId,
            },
          );
          break;
        }

        // Guard: if the customer still has another active subscription (e.g. they
        // upgraded in-place and the old sub was deleted immediately after), do NOT
        // downgrade to free — the invoice.paid for the new sub will set the correct plan.
        const remainingActive = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        if (remainingActive.data.length > 0) {
          break;
        }

        await markFreeAndClearPostsByProfileId(profileId, "inactive");
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : null;

        const profileId = await resolveProfileId({
          stripe,
          customerId,
          email: invoice.customer_email,
        });

        if (profileId) {
          // Resolve plan from the invoice's subscription.
          // invoice.subscription can be a string ID or an expanded object.
          let priceId = "";
          const rawSub = (invoice as any).subscription;
          if (typeof rawSub === "string") {
            const subscription = await stripe.subscriptions.retrieve(rawSub);
            priceId = extractPriceId(subscription);
          } else if (rawSub && typeof rawSub === "object" && rawSub.id) {
            // Expanded subscription object — extract price directly
            priceId = rawSub.items?.data?.[0]?.price?.id ?? "";
            if (!priceId) {
              // Fallback: re-fetch from Stripe to be safe
              const subscription = await stripe.subscriptions.retrieve(
                rawSub.id as string,
              );
              priceId = extractPriceId(subscription);
            }
          }

          // Only update if we actually have a price ID.
          // An empty price means we couldn't determine the plan — skip to avoid
          // accidentally downgrading the user to free.
          if (priceId) {
            await markPaidByProfileId(profileId, "active", priceId);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : null;

        const profileId = await resolveProfileId({
          stripe,
          customerId,
          email: invoice.customer_email,
        });

        if (profileId) {
          await updateSubscriptionStatusOnly(profileId, "past_due");
        }

        break;
      }

      default:
        break;
    }

    // Mark event as processed AFTER successful handling.
    // This ensures failed processing is retried by Stripe (returns 500 below).
    await markWebhookEventProcessed(event);

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Stripe webhook failed:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

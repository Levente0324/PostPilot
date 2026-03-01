export type ProfileRow = {
  id: string;
  plan: string | null;
  subscription_status: string | null;
  monthly_post_limit: number | null;
};

export type Plan = "free" | "pro" | "elite";

/** Returns true if the profile has an active/trialing paid subscription */
function isPaidAndActive(
  profile: Pick<ProfileRow, "subscription_status"> | null | undefined,
) {
  return (
    !!profile &&
    (profile.subscription_status === "active" ||
      profile.subscription_status === "trialing")
  );
}

export function hasEliteAccess(
  profile: Pick<ProfileRow, "plan" | "subscription_status"> | null | undefined,
) {
  return !!profile && profile.plan === "elite" && isPaidAndActive(profile);
}

export function hasProAccess(
  profile: Pick<ProfileRow, "plan" | "subscription_status"> | null | undefined,
) {
  return !!profile && profile.plan === "pro" && isPaidAndActive(profile);
}

/** Returns true for any paid plan (pro or elite) */
export function hasPaidAccess(
  profile: Pick<ProfileRow, "plan" | "subscription_status"> | null | undefined,
) {
  return hasProAccess(profile) || hasEliteAccess(profile);
}

export function getPostLimit(
  profile: Pick<ProfileRow, "plan" | "subscription_status"> | null | undefined,
) {
  if (hasEliteAccess(profile)) return 50;
  if (hasProAccess(profile)) return 20;
  return 3; // Free
}

export function getPlanLabel(
  profile: Pick<ProfileRow, "plan" | "subscription_status"> | null | undefined,
): string {
  if (hasEliteAccess(profile)) return "Elite csomag";
  if (hasProAccess(profile)) return "Pro csomag";
  return "Ingyenes csomag";
}

/**
 * Given a Stripe price ID, returns the plan and monthly post limit.
 * Falls back to "pro" if the price ID doesn't match any known tier.
 */
export function resolvePlanFromPriceId(priceId: string): {
  plan: Plan;
  limit: number;
} {
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const elitePriceId = process.env.STRIPE_ELITE_PRICE_ID;

  if (proPriceId && priceId === proPriceId) {
    return { plan: "pro", limit: 20 };
  }
  if (elitePriceId && priceId === elitePriceId) {
    return { plan: "elite", limit: 50 };
  }
  // If a non-empty price ID doesn't match any known tier, default to "pro".
  // The user paid for *something* — downgrading to free would be worse than
  // granting minimum paid access. Log a warning so we can investigate.
  if (priceId) {
    console.warn(
      `resolvePlanFromPriceId: unknown price ID "${priceId}". Defaulting to pro. ` +
        `Expected PRO=${proPriceId ?? "(not set)"} or ELITE=${elitePriceId ?? "(not set)"}`,
    );
    return { plan: "pro", limit: 20 };
  }
  // Truly empty price ID — no subscription item at all
  return { plan: "free", limit: 3 };
}

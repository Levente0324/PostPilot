import {
  createStripeCheckoutSession,
  createStripePortalSession,
  syncStripeCheckoutSession,
} from "@/app/actions/stripe";
import { SocialConnections } from "@/components/dashboard/SocialConnections";
import { createClient } from "@/lib/supabase/server";
import {
  hasProAccess,
  hasEliteAccess,
  hasPaidAccess,
  getPlanLabel,
  getPostLimit,
} from "@/lib/subscription";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Sparkles,
  Zap,
} from "lucide-react";
import Stripe from "stripe";
import { redirect } from "next/navigation";

export default async function AccountBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  let checkoutSyncError: string | null = null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const qp = await searchParams;
  const checkout = typeof qp.checkout === "string" ? qp.checkout : null;
  const rawSessionId = typeof qp.session_id === "string" ? qp.session_id : null;
  const billingError =
    typeof qp.billing_error === "string" ? qp.billing_error : null;
  const metaError = typeof qp.meta_error === "string" ? qp.meta_error : null;
  const metaSuccess = typeof qp.meta === "string" ? qp.meta : null;
  const checkoutCancelled = checkout === "cancelled";
  const upgradeSuccess =
    typeof qp.upgrade === "string" && qp.upgrade === "success";

  // Guard: only process Stripe session IDs that look valid (starts with cs_, max 200 chars).
  // Prevents arbitrary session IDs being injected via URL manipulation.
  const sessionId =
    rawSessionId && rawSessionId.startsWith("cs_") && rawSessionId.length <= 200
      ? rawSessionId
      : null;

  if (checkout === "success" && sessionId) {
    const syncResult = await syncStripeCheckoutSession(sessionId);
    if (!syncResult.ok) {
      checkoutSyncError = `Stripe szinkronizálási hiba: ${syncResult.reason}`;
    } else {
      redirect("/dashboard/account-billing?checkout=success");
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, subscription_status, stripe_customer_id")
    .eq("id", user.id)
    .single();

  // Check if the paid subscription is set to cancel at period end
  let cancelAtDate: Date | null = null;
  if (profile?.stripe_customer_id && hasPaidAccess(profile)) {
    try {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey)
        throw new Error("STRIPE_SECRET_KEY is not configured.");
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2026-01-28.clover",
      });
      const subs = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      if (subs.data[0]?.cancel_at_period_end && subs.data[0].cancel_at) {
        cancelAtDate = new Date(subs.data[0].cancel_at * 1000);
      }
    } catch {
      // Non-fatal — cancellation banner is informational only
    }
  }

  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("provider, account_name, expires_at")
    .eq("user_id", user.id);

  const facebook = accounts?.find((a) => a.provider === "facebook") || null;
  const instagram = accounts?.find((a) => a.provider === "instagram") || null;

  const isPro = hasProAccess(profile);
  const isElite = hasEliteAccess(profile);
  const isPaid = hasPaidAccess(profile);
  const planLabel = getPlanLabel(profile);
  const postLimit = getPostLimit(profile);

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-40 h-20 px-4 md:px-8 flex flex-col md:flex-row md:items-center justify-between border-b border-light-clinical-gray bg-light-background">
        <div className="hidden md:block">
          <h1 className="font-sans text-3xl font-medium text-gray-900 tracking-wide leading-none">
            Fiók Kezelés
          </h1>
        </div>

        {/* Mobile Title */}
        <div className="md:hidden pt-2 pb-1">
          <h1 className="font-sans text-xl font-medium text-gray-900 tracking-wide leading-none">
            Fiók Kezelés
          </h1>
        </div>
      </header>

      <div className="p-4 md:p-8 relative z-0">
        <div className="max-w-[1400px] mx-auto space-y-6 pb-10">
          <p className="mt-2 text-sm leading-relaxed text-gray-500 mb-6 px-1">
            Kezeld az előfizetésed és kapcsold össze a közösségi média
            fiókjaidat.
          </p>

          {/* Alerts */}
          {billingError === "customer_missing" && (
            <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm px-6 py-4 text-sm text-amber-600">
              A Stripe ügyfélfiókod nem található (lehetséges teszt/éles
              környezet váltás). Az előfizetés felülete átmenetileg nem elérhető
              — kérjük vedd fel velünk a kapcsolatot.
            </div>
          )}
          {checkoutCancelled && (
            <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm px-6 py-4 text-sm text-amber-600">
              A fizetési folyamat megszakadt. Nem történt terhelés, a csomag nem
              változott.
            </div>
          )}
          {checkoutSyncError && (
            <div className="bg-white border border-red-200 rounded-xl shadow-sm px-6 py-4 text-sm text-red-600">
              {checkoutSyncError}. Próbáld újra, vagy vedd fel a kapcsolatot az
              ügyfélszolgálattal.
            </div>
          )}
          {checkout === "success" && !checkoutSyncError && (
            <div className="bg-white border border-green-200 rounded-xl shadow-sm px-6 py-4 text-sm text-green-600">
              🎉 Sikeres fizetés! A csomag aktiválva.
            </div>
          )}
          {upgradeSuccess && (
            <div className="bg-white border border-green-200 rounded-xl shadow-sm px-6 py-4 text-sm text-green-600">
              🎉 Sikeresen váltottál csomagot! Az új csomag azonnal életbe lép.
            </div>
          )}
          {cancelAtDate && (
            <div className="bg-white border border-amber-200 rounded-xl shadow-sm px-6 py-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <p className="text-sm text-amber-700">
                Az előfizetésed lemondásra van ütemezve.{" "}
                <span className="font-semibold">
                  {cancelAtDate.toLocaleDateString("hu-HU", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                -ig maradsz aktív. Utána ingyenes csomagra kerülsz vissza.
              </p>
            </div>
          )}
          {metaError && (
            <div className="bg-white border border-red-200 rounded-xl shadow-sm px-6 py-4 text-sm text-red-600">
              Hiba a Meta fiók csatlakoztatása közben:{" "}
              {metaError === "oauth_state"
                ? "Érvénytelen biztonsági kulcs (lejárt munkamenet)."
                : metaError === "no_pages"
                  ? "Nem található összekapcsolható Facebook oldal."
                  : metaError === "no_instagram_business"
                    ? "Nem található Instagram Üzleti (Business) vagy Alkotói (Creator) fiók a kiválasztott Facebook oldalhoz."
                    : metaError === "oauth_failed"
                      ? "A csatlakozás sikertelen volt (lehet, hogy hiányzik a megfelelő adatbázis oszlop, futtasd az SQL migrációt)."
                      : "Ismeretlen hiba történt."}
            </div>
          )}
          {metaSuccess === "connected" && (
            <div className="bg-white border border-green-200 rounded-xl shadow-sm px-6 py-4 text-sm text-green-600">
              🎉 Sikeresen összekapcsoltad a közösségi fiókodat!
            </div>
          )}

          {/* Current plan + Account */}
          <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm p-6 md:p-8">
            <h2 className="mb-5 text-xl font-sans font-semibold text-gray-900">
              Jelenlegi csomag
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div
                className={`rounded-xl border p-5 ${isPaid ? "border-light-primary/30 bg-light-primary/5" : "border-gray-200 bg-gray-50"}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  {isElite ? (
                    <Sparkles className="h-5 w-5 text-light-primary" />
                  ) : isPro ? (
                    <Zap className="h-5 w-5 text-gray-800" />
                  ) : (
                    <CreditCard className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="font-bold text-gray-900">{planLabel}</span>
                  {isPaid && (
                    <span className="rounded-full bg-light-primary/10 px-2 py-0.5 text-xs font-semibold text-light-primary border border-light-primary/20">
                      Aktív
                    </span>
                  )}
                </div>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />
                    {postLimit} aktív időzített poszt
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />
                    Facebook + Instagram
                  </li>
                  {isPro && (
                    <li className="flex items-center gap-2 text-sm text-gray-600">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />
                      AI szövegírás (hamarosan)
                    </li>
                  )}
                  {isElite && (
                    <>
                      <li className="flex items-center gap-2 text-sm text-gray-600">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />
                        AI szövegírás (hamarosan)
                      </li>
                      <li className="flex items-center gap-2 text-sm text-gray-600">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />
                        AI képgenerálás (hamarosan)
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p className="mb-2 text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
                  Fiók
                </p>
                <p className="font-semibold text-gray-900 truncate">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Manage subscription */}
            {isPaid && (
              <div className="mt-6">
                <form action={createStripePortalSession}>
                  <button
                    type="submit"
                    className="flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-gray-600 px-6 py-2 transition hover:border-light-primary/30 hover:bg-light-primary/5 hover:text-light-primary text-sm font-semibold"
                  >
                    Előfizetés kezelése (Stripe){" "}
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Social accounts */}
          <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm p-6 md:p-8">
            <h2 className="mb-2 text-xl font-sans font-semibold text-gray-900">
              Kapcsolt közösségi fiókok
            </h2>
            <p className="mb-6 text-sm text-gray-500">
              Csatlakoztasd Facebook vagy Instagram fiókodat az automatikus
              posztoláshoz.
            </p>
            <div className="p-1">
              <SocialConnections facebook={facebook} instagram={instagram} />
            </div>
          </div>

          {/* Pricing upgrade cards — shown when NOT on Elite */}
          {!isElite && (
            <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm p-6 md:p-8">
              <h2 className="mb-2 text-xl font-sans font-semibold text-gray-900">
                {isPro ? "Váltás Elite csomagra" : "Válassz csomagot"}
              </h2>
              <p className="mb-6 text-sm text-gray-500">
                Nincs kötöttség, bármikor lemondható.
              </p>

              <div
                className={`grid gap-5 ${isPro ? "max-w-md md:grid-cols-1" : "md:grid-cols-2"}`}
              >
                {/* Pro card — only shown for free users */}
                {!isPro && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 hover:border-gray-300 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="h-4 w-4 text-gray-800" />
                      <span className="text-xs font-mono font-bold uppercase tracking-widest text-gray-900">
                        Pro
                      </span>
                      <span className="ml-1 rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-500 shadow-sm">
                        Legnépszerűbb
                      </span>
                    </div>
                    <div className="mb-1">
                      <span className="text-3xl font-sans font-bold text-gray-900 leading-none">
                        3 990 Ft
                      </span>
                      <span className="text-gray-500">/hó</span>
                    </div>
                    <p className="mb-5 text-sm text-gray-500">
                      Kis vállalkozásoknak
                    </p>
                    <ul className="mb-6 space-y-2.5">
                      {[
                        "20 aktív időzített poszt",
                        "Facebook + Instagram",
                        "Carousel posztok",
                        "AI szövegírás (hamarosan)",
                      ].map((f) => (
                        <li
                          key={f}
                          className="flex items-center gap-2 text-sm text-gray-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />{" "}
                          {f}
                        </li>
                      ))}
                    </ul>
                    <form action={createStripeCheckoutSession}>
                      <input type="hidden" name="plan" value="pro" />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 px-4 py-3 transition font-semibold text-sm shadow-sm"
                      >
                        Pro előfizetés <ExternalLink className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                )}

                {/* Elite card */}
                <div className="relative overflow-hidden rounded-xl bg-light-primary/5 p-6 border border-light-primary/20 shadow-sm group hover:border-light-primary/40 transition-colors">
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-4 w-4 text-light-primary" />
                      <span className="text-xs font-mono font-bold uppercase tracking-widest text-light-primary">
                        Elite
                      </span>
                    </div>
                    <div className="mb-1">
                      <span className="text-3xl font-sans font-bold text-gray-900 leading-none">
                        7 990 Ft
                      </span>
                      <span className="text-gray-600">/hó</span>
                    </div>
                    <p className="mb-5 text-sm text-light-primary/80">
                      Növekvő vállalkozásoknak
                    </p>
                    <ul className="mb-6 space-y-2.5">
                      {[
                        "50 aktív időzített poszt",
                        "Facebook + Instagram",
                        "Carousel posztok",
                        "KORLÁTLAN AI szövegírás",
                        "KORLÁTLAN AI képgenerálás",
                        "Elsőbbségi támogatás",
                      ].map((f) => (
                        <li
                          key={f}
                          className="flex items-center gap-2 text-sm text-gray-800"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-light-primary" />{" "}
                          {f}
                        </li>
                      ))}
                    </ul>
                    <form action={createStripeCheckoutSession}>
                      <input type="hidden" name="plan" value="elite" />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-light-primary text-white px-4 py-3 transition hover:bg-light-primary-hover font-semibold text-sm shadow-sm"
                      >
                        Elite előfizetés <ExternalLink className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

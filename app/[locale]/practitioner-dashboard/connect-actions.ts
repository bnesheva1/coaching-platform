"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/siteOrigin";
import { ensureConnectAccount, createOnboardingLink } from "@/lib/payments/stripe/connect";

// Serves both "Connect Stripe" (first visit) and "Continue setup"
// (resuming) — identical call either way. ensureConnectAccount's own
// reuse-if-exists check is what makes the two cases the same code path;
// only the calling button's label differs based on current status.
export async function startStripeConnectOnboarding() {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/profile", query: { connectError: code } }, locale });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  // ensureConnectAccount runs via service-role, which bypasses RLS
  // entirely — unlike the row-scoped .update() calls elsewhere in this
  // dashboard (where a non-practitioner simply has no matching row to
  // affect), this explicit role check is the only thing stopping a
  // client-role user from spinning up an orphaned Stripe Express account
  // for themselves.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "practitioner") {
    await redirectWithError("notAPractitioner");
    return;
  }

  if (!user.email) {
    // Shouldn't happen — every account is created with an email — but
    // stripe.accounts.create requires one, so this is checked rather
    // than passed through as undefined.
    await redirectWithError("connectFailed");
    return;
  }

  const origin = await siteOrigin();
  const profilePath = `${origin}/${locale}/practitioner-dashboard/profile`;

  // redirect()/redirectExternal() work by throwing internally — calling
  // either one from inside a try/catch would let the catch block
  // wrongly intercept that as a failure, breaking the redirect. Errors
  // are caught here, before either ever runs; both redirects below are
  // unconditional and outside any catch scope.
  let onboardingUrl: string;
  try {
    const accountId = await ensureConnectAccount(user.id, user.email);
    onboardingUrl = await createOnboardingLink(accountId, profilePath, profilePath);
  } catch (err) {
    console.error("startStripeConnectOnboarding failed", { practitionerId: user.id, err });
    await redirectWithError("connectFailed");
    return;
  }

  redirectExternal(onboardingUrl);
}

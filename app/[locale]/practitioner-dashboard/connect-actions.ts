"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/siteOrigin";
import {
  ensureConnectAccount,
  createOnboardingLink,
  getConnectedAccountId,
  createExpressDashboardLoginLink,
} from "@/lib/payments/stripe/connect";

// Serves both "Connect Stripe" (first visit) and "Continue setup"
// (resuming) — identical call either way. ensureConnectAccount's own
// reuse-if-exists check is what makes the two cases the same code path;
// only the calling button's label differs based on current status.
export async function startStripeConnectOnboarding() {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { connectError: code } }, locale });
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
  const settingsPath = `${origin}/${locale}/practitioner-dashboard/settings`;

  // redirect()/redirectExternal() work by throwing internally — calling
  // either one from inside a try/catch would let the catch block
  // wrongly intercept that as a failure, breaking the redirect. Errors
  // are caught here, before either ever runs; both redirects below are
  // unconditional and outside any catch scope.
  let onboardingUrl: string;
  try {
    const accountId = await ensureConnectAccount(user.id, user.email);
    onboardingUrl = await createOnboardingLink(accountId, settingsPath, settingsPath);
  } catch (err) {
    console.error("startStripeConnectOnboarding failed", { practitionerId: user.id, err });
    await redirectWithError("connectFailed");
    return;
  }

  redirectExternal(onboardingUrl);
}

// Only ever rendered (see StripeConnectSection.tsx) once the account is
// connected and active — same auth + role checks as
// startStripeConnectOnboarding above, scoped to the caller's own
// account via getConnectedAccountId(user.id), never a client-supplied
// account id.
export async function manageStripeConnectAccount() {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { manageError: code } }, locale });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "practitioner") {
    await redirectWithError("notAPractitioner");
    return;
  }

  // redirect()/redirectExternal() throw internally — kept outside any
  // try/catch, same reasoning as startStripeConnectOnboarding above.
  let loginLinkUrl: string;
  try {
    const accountId = await getConnectedAccountId(user.id);
    if (!accountId) {
      // Shouldn't be reachable — the button that calls this action only
      // renders once isConnected is true — but a direct call (or a
      // stale page still showing the button after a state change)
      // shouldn't 500, just redirect with a clean error.
      await redirectWithError("notConnected");
      return;
    }
    loginLinkUrl = await createExpressDashboardLoginLink(accountId);
  } catch (err) {
    console.error("manageStripeConnectAccount failed", { practitionerId: user.id, err });
    await redirectWithError("manageFailed");
    return;
  }

  redirectExternal(loginLinkUrl);
}

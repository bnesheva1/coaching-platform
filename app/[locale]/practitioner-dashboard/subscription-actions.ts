"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/siteOrigin";
import { isEnabled } from "@/lib/flags";
import { createSubscriptionCheckoutUrl, createBillingPortalUrl, getBillingCustomerId } from "@/lib/payments/stripe/subscription";

// Enrol the current practitioner in the monthly platform-fee subscription — a
// Checkout Session in mode:"subscription". Same shape as
// startStripeConnectOnboarding (connect-actions.ts): auth + role check, then a
// redirect to a hosted Stripe page. The two are DIFFERENT Stripe relationships
// (Connect account we pay vs Customer/Subscription we charge) — this one never
// touches the connected account.
export async function startSubscription() {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { subscriptionError: code } }, locale });
  }

  // Built dormant: the feature ships off and is flipped on later ("recruiting
  // early practitioners free, adding the fee later"). Defensive — the UI hides
  // the button when the flag is off, but a direct call shouldn't enrol anyone.
  if (!(await isEnabled("subscriptionBilling"))) {
    await redirectWithError("subscriptionDisabled");
    return;
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

  if (!user.email) {
    await redirectWithError("subscriptionFailed");
    return;
  }

  // The practitioner's own subscription context via the narrow definer RPC
  // (the columns are admin-only). Exempt = active-and-charged-nothing, so there
  // is nothing to check out — send them back with a benign notice.
  const { data: ctx } = await supabase.rpc("get_my_subscription_context").single();
  const context = ctx as
    | { subscription_exempt: boolean; subscription_price_override_cents: number | null }
    | null;
  if (context?.subscription_exempt) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { subscriptionInfo: "exempt" } }, locale });
    return;
  }

  const origin = await siteOrigin();
  const settingsPath = `${origin}/${locale}/practitioner-dashboard/settings`;

  // redirect()/redirectExternal() throw internally — kept outside any try/catch,
  // same reasoning as connect-actions.ts.
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSubscriptionCheckoutUrl({
      practitionerId: user.id,
      email: user.email,
      priceOverrideCents: context?.subscription_price_override_cents ?? null,
      successUrl: `${settingsPath}?subscriptionInfo=started`,
      cancelUrl: `${settingsPath}?subscriptionInfo=cancelled`,
    });
  } catch (err) {
    console.error("startSubscription failed", { practitionerId: user.id, err });
    await redirectWithError("subscriptionFailed");
    return;
  }

  redirectExternal(checkoutUrl);
}

// Open the Stripe Billing Portal for the current practitioner — the hosted
// surface to update their card, view invoices, and manage/cancel. This is the
// "pay now / fix it" destination from the grace/lapsed banner: updating the
// card triggers a retry → invoice.paid → active, restoring them automatically.
export async function openBillingPortal() {
  const locale = await getLocale();

  async function redirectWithError(code: string) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { subscriptionError: code } }, locale });
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

  const origin = await siteOrigin();
  const returnUrl = `${origin}/${locale}/practitioner-dashboard/settings`;

  let portalUrl: string;
  try {
    const customerId = await getBillingCustomerId(user.id);
    if (!customerId) {
      // No Customer yet — they've never subscribed, so there's nothing to
      // manage. Shouldn't be reachable (the portal button only renders once
      // enrolled), but a direct call redirects cleanly rather than 500ing.
      await redirectWithError("notSubscribed");
      return;
    }
    portalUrl = await createBillingPortalUrl(customerId, returnUrl);
  } catch (err) {
    console.error("openBillingPortal failed", { practitionerId: user.id, err });
    await redirectWithError("subscriptionFailed");
    return;
  }

  redirectExternal(portalUrl);
}

"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect, getPathname } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/siteOrigin";
import { isEnabled } from "@/lib/flags";
import { createSubscriptionCheckoutUrl, createBillingPortalUrl, getBillingCustomerId } from "@/lib/payments/stripe/subscription";

type SubscriptionContext = {
  subscription_exempt: boolean;
  subscription_price_override_cents: number | null;
  has_subscription: boolean;
};

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
  const context = ctx as SubscriptionContext | null;
  if (context?.subscription_exempt) {
    redirect({ href: { pathname: "/practitioner-dashboard/settings", query: { subscriptionInfo: "exempt" } }, locale });
    return;
  }

  const origin = await siteOrigin();
  const settingsPath = `${origin}${getPathname({ href: "/practitioner-dashboard/settings", locale })}`;

  // redirect()/redirectExternal() throw internally — kept outside any try/catch,
  // same reasoning as connect-actions.ts.
  let externalUrl: string;
  try {
    if (context?.has_subscription) {
      // Already enrolled — a lapse is a past_due/unpaid subscription that STILL
      // EXISTS; reviving it is "pay and become visible again," never a second
      // subscription. So an enrolled (incl. lapsed) practitioner goes to the
      // Billing Portal to update their card → Stripe retries → invoice.paid →
      // active. Only the exempt path cancels a subscription, and it also clears
      // the stored id, so an un-exempted practitioner falls through to a genuine
      // fresh checkout below.
      const customerId = await getBillingCustomerId(user.id);
      if (!customerId) throw new Error("has_subscription but no stored customer id");
      externalUrl = await createBillingPortalUrl(customerId, `${settingsPath}?subscriptionInfo=managed`);
    } else {
      externalUrl = await createSubscriptionCheckoutUrl({
        practitionerId: user.id,
        email: user.email,
        priceOverrideCents: context?.subscription_price_override_cents ?? null,
        successUrl: `${settingsPath}?subscriptionInfo=started`,
        cancelUrl: `${settingsPath}?subscriptionInfo=cancelled`,
      });
    }
  } catch (err) {
    console.error("startSubscription failed", { practitionerId: user.id, err });
    await redirectWithError("subscriptionFailed");
    return;
  }

  redirectExternal(externalUrl);
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
  const returnUrl = `${origin}${getPathname({ href: "/practitioner-dashboard/settings", locale })}`;

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

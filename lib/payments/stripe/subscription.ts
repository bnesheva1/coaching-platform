import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendSubscriptionGraceEmail } from "@/lib/email";

// ── Config (deployment-scope, read once at module load) ──────────────
// The monthly platform fee a practitioner pays. Two Stripe objects back this:
// a Customer (we charge them) and a Subscription on that Customer — SEPARATE
// from their Connect account (we pay them). See the migration header.
//
// SUBSCRIPTION_PRICE_ID is the pre-created recurring Price for the brand
// default. If it's unset (e.g. a fresh test deployment that hasn't created a
// Price in the Dashboard yet), we fall back to an inline price_data at
// SUBSCRIPTION_PRICE_CENTS so the flow still works. A per-practitioner CUSTOM
// amount always uses inline price_data — no Price-object sprawl.

function resolveDefaultPriceCents(): number {
  const raw = process.env.SUBSCRIPTION_PRICE_CENTS;
  if (raw === undefined || raw.trim() === "") return 1500; // €15 default
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1500;
}

export const SUBSCRIPTION_PRICE_CENTS = resolveDefaultPriceCents();
export const SUBSCRIPTION_CURRENCY = (process.env.SUBSCRIPTION_CURRENCY?.trim() || "eur").toLowerCase();

function subscriptionPriceId(): string | undefined {
  return process.env.SUBSCRIPTION_PRICE_ID?.trim() || undefined;
}

function subscriptionProductId(): string | undefined {
  return process.env.SUBSCRIPTION_PRODUCT_ID?.trim() || undefined;
}

// The effective monthly fee for a practitioner: exempt pays nothing (a status,
// not an absence — see the migration), a custom override pays that, otherwise
// the brand default. Resolved the same way everywhere it's shown or charged.
export function effectiveSubscriptionCents(exempt: boolean, overrideCents: number | null | undefined): number {
  if (exempt) return 0;
  return overrideCents ?? SUBSCRIPTION_PRICE_CENTS;
}

// ── The "customer we charge" relationship ────────────────────────────
// Mirrors ensureConnectAccount (connect.ts) — reuse-if-exists, service-role
// throughout (stripe_customer_id is admin-only / not client-granted), write
// back immediately so a concurrent second click finds the same id rather than
// creating a duplicate Customer. Distinct from the Connect account entirely.
export async function ensureBillingCustomer(practitionerId: string, email: string): Promise<string> {
  const supabase = createServiceRoleClient();

  const { data: profile } = await supabase
    .from("practitioner_profiles")
    .select("stripe_customer_id")
    .eq("id", practitionerId)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata: { practitioner_id: practitionerId },
  });

  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", practitionerId);
  if (error) {
    // The Customer exists on Stripe regardless — a failed write here just means
    // the next call re-looks-up, finds nothing, and creates ANOTHER Customer
    // (a harmless orphan, no charge attached until a Subscription is). Logged,
    // not retried. Same trade-off as ensureConnectAccount.
    console.error("ensureBillingCustomer: Stripe customer created but DB write failed", {
      practitionerId,
      customerId: customer.id,
      error,
    });
  }

  return customer.id;
}

// Service-role read of stripe_customer_id (admin-only column), for actions that
// need the existing Customer without creating one — e.g. the Billing Portal,
// only reachable once a customer exists. Mirrors getConnectedAccountId.
export async function getBillingCustomerId(practitionerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("practitioner_profiles")
    .select("stripe_customer_id")
    .eq("id", practitionerId)
    .single();
  return data?.stripe_customer_id ?? null;
}

// The subscription line item: a custom override uses inline price_data (a
// recurring Price built on the fly), the default uses the pre-created Price id
// if configured, else inline price_data at the default cents. Everything is a
// monthly recurring item — this is Billing, not a one-off charge.
function subscriptionLineItem(priceOverrideCents: number | null | undefined): Stripe.Checkout.SessionCreateParams.LineItem {
  const custom = priceOverrideCents != null;
  if (!custom && subscriptionPriceId()) {
    return { price: subscriptionPriceId(), quantity: 1 };
  }
  const unitAmount = custom ? (priceOverrideCents as number) : SUBSCRIPTION_PRICE_CENTS;
  const productId = subscriptionProductId();
  return {
    price_data: {
      currency: SUBSCRIPTION_CURRENCY,
      recurring: { interval: "month" },
      unit_amount: unitAmount,
      // Use the configured Product when present; otherwise name it inline so a
      // deployment without a pre-created Product still works in test mode.
      ...(productId ? { product: productId } : { product_data: { name: "Platform membership" } }),
    },
    quantity: 1,
  };
}

// Enrol a practitioner: a Checkout Session in mode:"subscription". Ensures the
// Customer first (so the same person isn't charged twice / re-created), then a
// hosted subscription checkout. Stripe creates the Subscription when checkout
// completes; the webhook (customer.subscription.* / invoice.paid) records the
// subscription id + status onto the row. Returns the hosted URL to redirect to.
export async function createSubscriptionCheckoutUrl(opts: {
  practitionerId: string;
  email: string;
  priceOverrideCents: number | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripeClient();
  const customerId = await ensureBillingCustomer(opts.practitionerId, opts.email);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [subscriptionLineItem(opts.priceOverrideCents)],
    // Carried onto the Subscription so a webhook can always attribute it back to
    // the practitioner even before we've stored the subscription id.
    subscription_data: { metadata: { practitioner_id: opts.practitionerId } },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe subscription Checkout Session created with no url");
  }
  return session.url;
}

// The Billing Portal: Stripe's hosted surface to update the card, see invoices,
// and cancel. This is the "pay now / fix it" destination for a grace/lapsed
// practitioner — updating the card triggers a retry → invoice.paid → active.
export async function createBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

// Cancel a practitioner's live subscription immediately (used when an admin
// marks them exempt — an exempt practitioner is active-and-charged-nothing, so
// no Stripe subscription should keep billing). Idempotent-ish: a missing/
// already-canceled subscription just no-ops via the caller's guard.
export async function cancelPractitionerSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.subscriptions.cancel(subscriptionId);
}

// ── Webhook sync: Stripe is the source of truth ──────────────────────

// Map a Stripe subscription status onto our lifecycle column. Returns null for
// statuses we deliberately don't act on — incomplete/incomplete_expired never
// became active, so under lapse-only they must not restrict (leaving the row at
// its existing 'not_required').
function mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): "active" | "grace" | "lapsed" | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "grace"; // Stripe is retrying (~1 week); still bookable, notices sent.
    case "unpaid":
    case "canceled":
      return "lapsed"; // Dunning exhausted or canceled after being active → restrict.
    case "incomplete":
    case "incomplete_expired":
    default:
      return null;
  }
}

// current_period_end has lived on the Subscription in most API versions but
// moved to the item level in newer ones — read whichever is present.
function subscriptionPeriodEndISO(sub: Stripe.Subscription): string | null {
  const raw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000).toISOString() : null;
}

function customerIdOf(ref: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

// customer.subscription.created / .updated / .deleted all carry a Subscription.
// Route them all here: look the practitioner up by the Customer id we stored at
// enrolment, map the status, and persist. The `.neq('subscription_status',
// 'exempt')` guard means an admin-driven cancel (exempt) never flips the row to
// lapsed — the deleted event that our own cancel produces is simply ignored.
export async function handleSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  if (!customerId) {
    console.error("handleSubscriptionEvent: no customer on subscription", { subscriptionId: subscription.id });
    return;
  }

  const mapped = mapSubscriptionStatus(subscription.status);
  const supabase = createServiceRoleClient();

  // Always record the subscription id (first time we learn it) + the period
  // end; only overwrite subscription_status when we have a mapped value.
  const update: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    subscription_current_period_end: subscriptionPeriodEndISO(subscription),
  };
  if (mapped) update.subscription_status = mapped;

  const { error } = await supabase
    .from("practitioner_profiles")
    .update(update)
    .eq("stripe_customer_id", customerId)
    .neq("subscription_status", "exempt");

  if (error) {
    console.error("handleSubscriptionEvent: failed to update practitioner_profiles", { customerId, error });
  }
}

// invoice.paid — the authoritative "a subscription payment cleared" signal.
// Set active + roll the period end forward. Clears grace/lapsed automatically:
// a practitioner who updates their card in the Billing Portal produces exactly
// this event, restoring them with no further action. Exempt rows are untouched.
export async function handleSubscriptionInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  // Ignore non-subscription invoices (this app only bills subscriptions via the
  // Customer relationship, but be defensive against future one-off invoices).
  if (!isSubscriptionInvoice(invoice)) return;

  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("practitioner_profiles")
    .update({
      subscription_status: "active",
      ...(typeof periodEnd === "number" ? { subscription_current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
    })
    .eq("stripe_customer_id", customerId)
    .neq("subscription_status", "exempt");

  if (error) {
    console.error("handleSubscriptionInvoicePaid: failed to update practitioner_profiles", { customerId, error });
  }
}

// invoice.payment_failed — the FIRST failure, before any restriction. Notices
// start here (a failed card is usually just expired). The status transition to
// grace/lapsed rides on customer.subscription.updated (past_due → grace); this
// handler's job is the notification: resolve the practitioner by their stored
// Customer id and email them that a payment failed and needs attention.
export async function handleSubscriptionInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId || !isSubscriptionInvoice(invoice)) return;

  const supabase = createServiceRoleClient();
  const { data: prac } = await supabase
    .from("practitioner_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!prac?.id) {
    console.error("handleSubscriptionInvoicePaymentFailed: no practitioner for customer", { customerId });
    return;
  }
  await sendSubscriptionGraceEmail(prac.id as string);
}

// A subscription invoice carries a billing_reason of subscription_* (create /
// cycle / update). Guards the invoice handlers against unrelated invoices.
function isSubscriptionInvoice(invoice: Stripe.Invoice): boolean {
  const reason = invoice.billing_reason ?? "";
  return reason.startsWith("subscription");
}

import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { commissionCentsFor, COMMISSION_RATE } from "./checkout";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendPaidBookingConfirmationEmails, sendPaymentRefundedNotice } from "@/lib/email";
import { ensureVideoSession } from "@/lib/video";
import { finalizeImmediatePayment } from "@/lib/immediate/booking";
import {
  handleSubscriptionEvent,
  handleSubscriptionInvoicePaid,
  handleSubscriptionInvoicePaymentFailed,
} from "./subscription";

// Signature verification needs the RAW request body — constructEvent
// re-computes the signature over the exact bytes Stripe sent and
// rejects anything that doesn't match byte-for-byte, so a body already
// parsed/re-serialized by request.json() would fail verification even
// for a genuine event. The route handler is responsible for passing the
// untouched text.
export function verifyStripeWebhookEvent(rawBody: string, signatureHeader: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return getStripeClient().webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

// v2 "thin" events (Connect account capability updates) are a genuinely
// different payload shape from v1 events, not just a different `type` —
// Stripe's own SDK rejects a v2 payload passed to constructEvent above
// ("Use stripe.parseEventNotification instead", confirmed live) and
// vice versa. Both still carry the same stripe-signature header scheme,
// so the actual cryptographic verification happens in whichever of
// these two functions is called — peeking at the raw body's own
// `object` field first (see isThinEventPayload) only decides which
// verifier to run, it grants no bypass: a forged `object` field just
// routes to a verifier that then correctly fails on that payload.
// THE single source of truth for which v1 (snapshot) webhook events this app
// handles, and how. The route dispatches off this map, and the health config
// check derives its "required events" list from the keys — so adding a handled
// event here (a) wires it into the route and (b) makes the config check verify
// Stripe is actually subscribed to it, with no second list to update. Each entry
// takes the raw event and casts its own payload (the entry knows its shape),
// giving the map a single uniform signature.
export const STRIPE_V1_WEBHOOK_HANDLERS: Record<string, (event: Stripe.Event) => Promise<void>> = {
  "checkout.session.completed": (e) => handleCheckoutSessionCompleted(e.data.object as Stripe.Checkout.Session),
  "invoice.paid": (e) => handleSubscriptionInvoicePaid(e.data.object as Stripe.Invoice),
  "invoice.payment_failed": (e) => handleSubscriptionInvoicePaymentFailed(e.data.object as Stripe.Invoice),
  "customer.subscription.updated": (e) => handleSubscriptionEvent(e.data.object as Stripe.Subscription),
  "customer.subscription.deleted": (e) => handleSubscriptionEvent(e.data.object as Stripe.Subscription),
};

// Derived, never hand-maintained — the config check reads this to confirm the
// Stripe endpoint is subscribed to every event we actually handle.
export const REQUIRED_STRIPE_V1_EVENTS: readonly string[] = Object.keys(STRIPE_V1_WEBHOOK_HANDLERS);

export function isThinEventPayload(rawBody: string): boolean {
  try {
    return JSON.parse(rawBody)?.object === "v2.core.event";
  } catch {
    return false;
  }
}

export function verifyStripeThinEvent(rawBody: string, signatureHeader: string) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return getStripeClient().parseEventNotification(rawBody, signatureHeader, webhookSecret);
}

type CheckoutMetadata = {
  practitioner_id: string;
  client_id: string;
  service_id: string;
  start_utc: string;
};

function readMetadata(session: Stripe.Checkout.Session): CheckoutMetadata | null {
  const m = session.metadata;
  if (!m?.practitioner_id || !m?.client_id || !m?.service_id || !m?.start_utc) {
    return null;
  }
  return {
    practitioner_id: m.practitioner_id,
    client_id: m.client_id,
    service_id: m.service_id,
    start_utc: m.start_utc,
  };
}

// The commission snapshot the checkout builder stamped into session metadata
// at charge time: the resolved per-practitioner rate and the exact fee. We
// record THESE rather than recompute, so a later rate change never rewrites
// what was charged. Legacy fallback (a session created before the snapshot
// existed): rate unknown (null), fee recomputed from the brand default —
// which is exactly what the old code always did.
function readCommission(session: Stripe.Checkout.Session, amountCents: number): { rate: number | null; cents: number } {
  const rawRate = session.metadata?.commission_rate;
  const rawCents = session.metadata?.commission_cents;
  if (rawRate != null && rawCents != null) {
    const rate = Number(rawRate);
    const cents = Number(rawCents);
    if (Number.isFinite(rate) && Number.isFinite(cents)) return { rate, cents };
  }
  return { rate: null, cents: commissionCentsFor(amountCents, COMMISSION_RATE) };
}

// The only event this module needs to handle at all. checkout.session.
// expired is deliberately NOT subscribed to — under book-on-successful-
// payment, an expired/abandoned session never created a booking or a
// payment row in the first place, so there is nothing to release or
// clean up. That's a direct consequence of not reserving the slot
// during Checkout, not an oversight.
export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") {
    // Shouldn't occur for this event with card-only payment methods
    // (see checkout.ts), but defensive: only a confirmed charge should
    // ever reach confirm_paid_booking.
    return;
  }

  // Immediate-booking sessions carry immediate_request_id and take the off-grid
  // path: the booking is created at THIS moment (payment clear), start = now, no
  // grid rounding. If the practitioner's payment window already elapsed and they
  // moved on (booked:false), there is no session to honour — refund the client,
  // since we can't retroactively reserve a window the practitioner has released.
  const immediateRequestId = session.metadata?.immediate_request_id;
  if (immediateRequestId) {
    const immediatePi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    const immediateAmount = session.amount_total ?? 0;
    const { booked, bookingId, alreadyBooked } = await finalizeImmediatePayment(immediateRequestId);
    if (booked && bookingId && immediatePi) {
      // The immediate path books but writes no payments row of its own —
      // record it here so its commission (rate + cents, from the snapshot
      // metadata) is captured and counted in the revenue rollup, like the
      // scheduled path's confirm_paid_booking does.
      await recordImmediatePayment(session, immediatePi, bookingId, immediateAmount, readCommission(session, immediateAmount));
    } else if (!booked && !alreadyBooked && immediatePi) {
      // Genuinely couldn't book (the practitioner's window lapsed and they
      // moved on) — refund. NOT reached for a redelivery/reconcile of an
      // already-booked session (alreadyBooked), which must never refund a
      // paid, booked session.
      await refundLateImmediatePayment(session, immediatePi, immediateAmount, {
        clientId: session.metadata?.client_id ?? "",
        practitionerId: session.metadata?.practitioner_id ?? "",
      });
    }
    return;
  }

  const metadata = readMetadata(session);
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amountCents = session.amount_total ?? 0;

  if (!metadata || !paymentIntentId) {
    console.error("handleCheckoutSessionCompleted: missing metadata or payment_intent", { sessionId: session.id });
    // Nothing we can safely act on — no booking to create, no reliable
    // way to attribute a refund. Logged loudly for manual follow-up;
    // this should never happen since we control what metadata was set.
    return;
  }

  type ConfirmPaidBookingResult = { booking_id: string | null; already_processed: boolean; failure_reason: string | null };

  const commission = readCommission(session, amountCents);
  const supabase = createServiceRoleClient();
  const { data: rawResult, error } = await supabase
    .rpc("confirm_paid_booking", {
      p_practitioner_id: metadata.practitioner_id,
      p_client_id: metadata.client_id,
      p_service_id: metadata.service_id,
      p_start_utc: metadata.start_utc,
      p_checkout_session_id: session.id,
      p_amount_cents: amountCents,
      p_commission_cents: commission.cents,
      p_commission_rate: commission.rate,
      p_currency: (session.currency ?? "eur").toUpperCase(),
      p_payment_intent_id: paymentIntentId,
    })
    .single();
  const data = rawResult as ConfirmPaidBookingResult | null;

  if (error || !data) {
    // An unexpected DB-layer failure, not a validated "can't book"
    // outcome — nothing was recorded, so do NOT refund here. Throwing
    // makes the route handler return a non-2xx, which makes Stripe
    // retry delivery later; the idempotency check at the top of
    // confirm_paid_booking makes that retry safe.
    console.error("confirm_paid_booking RPC failed", { sessionId: session.id, error });
    throw new Error("confirm_paid_booking failed");
  }

  if (data.already_processed) {
    // Either the webhook was redelivered, or the cron reconciliation
    // sweep already handled this exact session. Nothing more to do —
    // this IS the idempotency guarantee, not a fallback for it.
    return;
  }

  if (data.failure_reason || !data.booking_id) {
    // Payment succeeded, but the booking genuinely couldn't be created
    // (lost the double-booking race, the slot fell inside the notice
    // window while Checkout was open, or the service was deactivated
    // mid-flow). The client was charged for nothing — refund and tell
    // them why. The !data.booking_id half of this check is defensive —
    // the SQL function never actually returns that combination, but it
    // keeps booking_id provably non-null below without a cast.
    await refundUnconfirmablePayment(session, paymentIntentId, amountCents, metadata, data.failure_reason ?? "unknown");
    return;
  }

  // Success: the webhook-appropriate confirmation send — same
  // templates as bookSlot's software_provider path, different fetch
  // mechanism (see lib/email/index.ts's own comment on why these are
  // separate functions), now carrying the amount paid.
  await sendPaidBookingConfirmationEmails(
    data.booking_id,
    amountCents,
    (session.currency ?? "eur").toUpperCase(),
  );

  // Create the video session for an online booking — the paid-path
  // counterpart to bookSlot's own ensureVideoSession call. Self-guards on
  // delivery_type (a non-online booking is a no-op) and never throws, so
  // it can't turn a confirmed, paid booking into a webhook failure.
  await ensureVideoSession(data.booking_id);
}

// No booking exists for this session — confirm_paid_booking's failure
// branches never insert one. Stripe's own refund API is itself
// idempotent for a given payment_intent (a second refund attempt on an
// already-fully-refunded intent errors rather than double-refunding),
// which is what makes this safe to call again if webhook delivery is
// ever retried in the narrow window between a first attempt's DB
// failure and this function completing.
async function refundUnconfirmablePayment(
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  amountCents: number,
  metadata: CheckoutMetadata,
  failureReason: string,
): Promise<void> {
  const stripe = getStripeClient();
  const supabase = createServiceRoleClient();
  // The snapshot from metadata (or the legacy recompute) — zero at a zero
  // commission rate, so there's nothing to reverse (and nothing but €0 to
  // record). refund_application_fee gates on the actually-charged fee.
  const commission = readCommission(session, amountCents);
  const feeCents = commission.cents;

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: feeCents > 0,
    });

    const { error } = await supabase.from("payments").insert({
      booking_id: null,
      stripe_checkout_session_id: session.id,
      amount_cents: amountCents,
      commission_cents: feeCents,
      commission_rate: commission.rate,
      currency: (session.currency ?? "eur").toUpperCase(),
      status: "refunded",
      provider_ref: { payment_intent_id: paymentIntentId, refund_id: refund.id, failure_reason: failureReason },
    });
    if (error) {
      console.error("refundUnconfirmablePayment: Stripe refund succeeded but DB insert failed", {
        sessionId: session.id,
        refundId: refund.id,
        error,
      });
    }
  } catch (stripeError) {
    console.error("refundUnconfirmablePayment: Stripe refund call failed", { sessionId: session.id, stripeError });
    // Not re-thrown: throwing here would make Stripe retry the whole
    // webhook, re-running confirm_paid_booking (harmless — it fails the
    // same way again) but also retrying THIS refund, which is exactly
    // the scenario the try/catch + Stripe's own idempotency exists for.
    // Logged loudly for manual follow-up rather than silently dropped.
  }

  await sendPaymentRefundedNotice({
    clientId: metadata.client_id,
    practitionerId: metadata.practitioner_id,
    amountCents,
    currency: (session.currency ?? "eur").toUpperCase(),
  });
}

// The immediate-path counterpart: payment cleared, but the practitioner's payment
// window had already lapsed (they were freed and told), so finalizeImmediatePayment
// declined to book. No booking exists — refund the client. Same idempotent Stripe
// refund + payments row (booking_id null) + client notice as the scheduled path.
async function refundLateImmediatePayment(
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  amountCents: number,
  parties: { clientId: string; practitionerId: string },
): Promise<void> {
  const stripe = getStripeClient();
  const supabase = createServiceRoleClient();
  const commission = readCommission(session, amountCents);
  const feeCents = commission.cents;

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: feeCents > 0,
    });

    const { error } = await supabase.from("payments").insert({
      booking_id: null,
      stripe_checkout_session_id: session.id,
      amount_cents: amountCents,
      commission_cents: feeCents,
      commission_rate: commission.rate,
      currency: (session.currency ?? "eur").toUpperCase(),
      status: "refunded",
      provider_ref: { payment_intent_id: paymentIntentId, refund_id: refund.id, failure_reason: "immediate_window_lapsed" },
    });
    if (error) {
      console.error("refundLateImmediatePayment: Stripe refund succeeded but DB insert failed", {
        sessionId: session.id,
        refundId: refund.id,
        error,
      });
    }
  } catch (stripeError) {
    console.error("refundLateImmediatePayment: Stripe refund call failed", { sessionId: session.id, stripeError });
  }

  await sendPaymentRefundedNotice({
    clientId: parties.clientId,
    practitionerId: parties.practitionerId,
    amountCents,
    currency: (session.currency ?? "eur").toUpperCase(),
  });
}

// Records the succeeded payment for an immediate booking. The immediate path
// (lib/immediate/booking.ts) creates the booking but no payments row; this is
// its counterpart to the scheduled path's confirm_paid_booking insert —
// snapshotting the commission rate + cents from the session metadata so
// immediate commissions are frozen per-payment and counted in the revenue
// rollup. Best-effort/logged: the client has already paid and been booked, so
// a payments-row hiccup must not fail the webhook.
async function recordImmediatePayment(
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  bookingId: string,
  amountCents: number,
  commission: { rate: number | null; cents: number },
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("payments").insert({
    booking_id: bookingId,
    stripe_checkout_session_id: session.id,
    amount_cents: amountCents,
    commission_cents: commission.cents,
    commission_rate: commission.rate,
    currency: (session.currency ?? "eur").toUpperCase(),
    status: "succeeded",
    provider_ref: { payment_intent_id: paymentIntentId },
  });
  if (error) {
    console.error("recordImmediatePayment: payments insert failed", { sessionId: session.id, bookingId, error });
  }
}

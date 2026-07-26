import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { commissionCentsFor } from "./checkout";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendPaidBookingConfirmationEmails, sendPaymentRefundedNotice } from "@/lib/email";

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

  const supabase = createServiceRoleClient();
  const { data: rawResult, error } = await supabase
    .rpc("confirm_paid_booking", {
      p_practitioner_id: metadata.practitioner_id,
      p_client_id: metadata.client_id,
      p_service_id: metadata.service_id,
      p_start_utc: metadata.start_utc,
      p_checkout_session_id: session.id,
      p_amount_cents: amountCents,
      p_commission_cents: commissionCentsFor(amountCents),
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

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: true,
    });

    const { error } = await supabase.from("payments").insert({
      booking_id: null,
      stripe_checkout_session_id: session.id,
      amount_cents: amountCents,
      commission_cents: commissionCentsFor(amountCents),
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

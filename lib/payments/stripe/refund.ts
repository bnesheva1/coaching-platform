import { getStripeClient } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// A direct server-to-server call — WE ask Stripe to refund, and trust
// its synchronous response, unlike the original charge (which only
// exists because the CLIENT'S browser completed Checkout, a step this
// server never directly witnesses — that's why payment success is only
// ever confirmed via a webhook, but a refund we initiate ourselves
// needs no such confirmation channel).
export async function refundBookingPayment(bookingId: string): Promise<{ refunded: boolean; reason?: string }> {
  const supabase = createServiceRoleClient();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, status, provider_ref")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .maybeSingle();

  if (!payment) {
    // Either this booking was never paid through us (shouldn't happen
    // for a commission-model booking, but callers don't need to know
    // that — see lib/payments/index.ts) or it's already refunded.
    // Neither is an error worth surfacing to the cancel action.
    return { refunded: false, reason: "no_succeeded_payment_found" };
  }

  const paymentIntentId = (payment.provider_ref as { payment_intent_id?: string })?.payment_intent_id;
  if (!paymentIntentId) {
    console.error("refundBookingPayment: payment row has no payment_intent_id", { bookingId, paymentId: payment.id });
    return { refunded: false, reason: "missing_payment_intent" };
  }

  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    reverse_transfer: true,
    refund_application_fee: true,
  });

  const { error } = await supabase
    .from("payments")
    .update({
      status: "refunded",
      provider_ref: { ...(payment.provider_ref as object), refund_id: refund.id },
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  if (error) {
    // The Stripe refund already succeeded at this point — logging loudly
    // rather than returning refunded: false, since telling the caller
    // "not refunded" here would be a lie (the client's money IS back).
    console.error("refundBookingPayment: Stripe refund succeeded but DB update failed", {
      bookingId,
      paymentId: payment.id,
      refundId: refund.id,
      error,
    });
  }

  return { refunded: true };
}

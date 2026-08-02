import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { createBookingCheckoutSession } from "./stripe/checkout";
import { refundBookingPayment as refundViaStripe } from "./stripe/refund";
import type { BookingPaymentRequest, InitiatePaymentResult, RefundResult, BillingModel } from "./types";

export type { BillingModel, BookingPaymentRequest, InitiatePaymentResult, RefundResult } from "./types";

// THE seam. Every other module in this app calls exactly these two
// functions and nothing else — no caller outside lib/payments/ imports
// the Stripe SDK, knows what a Checkout Session is, or knows Connect
// exists. Both functions dispatch on the practitioner's own
// billing_model; adding a third model later means adding a branch here,
// not touching booking-actions.ts or the cancel actions.

export async function initiateBookingPayment(request: BookingPaymentRequest): Promise<InitiatePaymentResult> {
  // Service-role, not the caller's own session — this reads an
  // ARBITRARY practitioner's row (whoever's being booked, not the
  // caller's own), and practitioner_profiles' column grants deliberately
  // exclude stripe_connected_account_id/stripe_connect_transfers_active
  // from client-session access (see the grants migration). Same pattern
  // bookSlot's software_provider path already uses for services.
  // phone_number/meeting_link.
  const supabase = createServiceRoleClient();
  const { data: practitionerProfile } = await supabase
    .from("practitioner_profiles")
    .select("billing_model, stripe_connected_account_id, stripe_connect_transfers_active")
    .eq("id", request.practitionerId)
    .single();

  const billingModel: BillingModel = (practitionerProfile?.billing_model as BillingModel | undefined) ?? "software_provider";

  if (billingModel === "software_provider") {
    // No payment gate for this practitioner — the caller should create
    // the booking immediately, exactly like every booking before this
    // epic existed.
    return { type: "no_payment_required" };
  }

  if (!practitionerProfile?.stripe_connected_account_id || !practitionerProfile.stripe_connect_transfers_active) {
    // A commission-model practitioner who hasn't connected Stripe yet,
    // or whose account can't yet receive transfers (set from the v2
    // Connect webhook once Stripe's own capability check clears) — the
    // normal state for anyone mid-onboarding, not a configuration error.
    // Distinct from "error" below so the caller can show a specific,
    // honest message rather than a generic "couldn't book" one.
    return { type: "practitioner_not_ready" };
  }

  try {
    const { url } = await createBookingCheckoutSession(request, practitionerProfile.stripe_connected_account_id);
    return { type: "redirect", url };
  } catch (err) {
    // Network failure, missing/invalid STRIPE_SECRET_KEY, or Stripe
    // rejecting the connected account (restricted, incomplete
    // onboarding) — all surface here rather than as an uncaught
    // exception in the calling Server Action.
    console.error("initiateBookingPayment: createBookingCheckoutSession failed", {
      practitionerId: request.practitionerId,
      serviceId: request.serviceId,
      err,
    });
    return { type: "error" };
  }
}

export async function refundBookingPayment(bookingId: string): Promise<RefundResult> {
  // billing_model isn't checked here on purpose — refundViaStripe looks
  // up a payments row by booking_id and simply finds none for a
  // software_provider booking (nothing was ever paid through us),
  // which is already exactly "not_applicable", not an error to branch
  // around.
  let result;
  try {
    result = await refundViaStripe(bookingId);
  } catch (err) {
    // stripe.refunds.create() itself failed (network, the connected
    // account can't accept the reverse_transfer, an already-refunded
    // intent, etc.) — caught here rather than left to propagate, since
    // by the time either cancel action calls this, the booking's own
    // cancellation has already committed. A thrown error here must
    // never turn an already-successful cancellation into a crash for
    // the caller; it becomes exactly the same "not refunded, logged for
    // follow-up" outcome the non-throwing failure branch below already
    // produces.
    console.error("refundBookingPayment: Stripe refund call threw", { bookingId, err });
    return { refunded: false, reason: "stripe_error" };
  }
  if (!result.refunded) {
    return {
      refunded: false,
      reason: result.reason === "no_succeeded_payment_found" ? "not_applicable" : (result.reason ?? "unknown"),
    };
  }
  return { refunded: true };
}

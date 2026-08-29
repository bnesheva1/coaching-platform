import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled } from "@/lib/flags";
import { type ConnectionResult, errorMessage } from "@/lib/health/types";
import { getStripeClient } from "./stripe/client";
import { createBookingCheckoutSession, effectiveCommissionRate } from "./stripe/checkout";
import { refundBookingPayment as refundViaStripe } from "./stripe/refund";
import type { BookingPaymentRequest, InitiatePaymentResult, RefundResult, BillingModel } from "./types";

export type { BillingModel, BookingPaymentRequest, InitiatePaymentResult, RefundResult } from "./types";
export { setPayoutsHold, getConnectedAccountId } from "./stripe/connect";

// Deployment-scope default for a newly-created practitioner's billing_model,
// read at creation (see signup/actions.ts). Lets a brand declare "all new
// practitioners are commission" via the DEFAULT_BILLING_MODEL env var, with
// no migration and no per-practitioner setting. Only the explicit string
// "commission" switches it; anything else (incl. unset) keeps the DB
// default. The per-practitioner column still overrides this afterwards.
export function defaultBillingModel(): BillingModel {
  return process.env.DEFAULT_BILLING_MODEL === "commission" ? "commission" : "software_provider";
}

// The payment provider's DISPLAY name, shown to practitioners (e.g. in the
// earnings breakdown on the service form). Config, not a literal — the provider
// lives behind this seam and a deployment may swap it, so the shown name follows
// it. Defaults to Stripe.
export function paymentProviderName(): string {
  return process.env.PAYMENT_PROVIDER_NAME?.trim() || "Stripe";
}

// The provider's card-processing fee, shown to practitioners as an APPROXIMATE
// range (it varies by card type and origin) — never as a single confident net.
// The config holds the numbers; the copy only interpolates them. Percentages are
// plain numbers (1.5 = 1.5%), fixed is in cents. Malformed/negative values fall
// back to sensible EU-band defaults.
export function processingFeeRange(): { minPct: number; maxPct: number; fixedCents: number } {
  const num = (raw: string | undefined, fallback: number) => {
    const n = raw && raw.trim() !== "" ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    minPct: num(process.env.PAYMENT_PROCESSING_FEE_MIN_PCT, 1.5),
    maxPct: num(process.env.PAYMENT_PROCESSING_FEE_MAX_PCT, 3.25),
    fixedCents: num(process.env.PAYMENT_PROCESSING_FEE_FIXED_CENTS, 25),
  };
}

// Mode is derived from the key prefix — no call needed — but the call itself
// (a cheap balance.retrieve) is what proves the key is actually VALID right now,
// not merely present. Both are reported: the mode always, the validity from the
// live call. Kept here in the payments seam so the health page never imports the
// Stripe SDK.
export function stripeMode(): "test" | "live" | "unknown" {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
}

export async function checkStripeConnection(): Promise<ConnectionResult> {
  const mode = stripeMode();
  try {
    await getStripeClient().balance.retrieve();
    return { ok: true, detail: `API key valid — ${mode} mode` };
  } catch (e) {
    return { ok: false, detail: `Stripe call failed (${mode} key)`, error: errorMessage(e) };
  }
}

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
    .select("billing_model, stripe_connected_account_id, stripe_connect_transfers_active, commission_rate_override")
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

  // Admin kill switch: Stripe Checkout paused. Checked here, the single
  // chokepoint every commission-model payment flows through, and only AFTER
  // the practitioner-readiness branch — so "payments paused" is a distinct,
  // deliberate state, not conflated with an onboarding gap or a Stripe error.
  if (!(await isEnabled("checkout"))) {
    return { type: "payments_disabled" };
  }

  try {
    // Resolve the practitioner's effective commission rate here (the single
    // chokepoint that already reads their profile) and hand it to checkout,
    // which stamps it into the session metadata as the snapshot.
    const rate = effectiveCommissionRate(practitionerProfile.commission_rate_override as number | null);
    const { url } = await createBookingCheckoutSession(request, practitionerProfile.stripe_connected_account_id, rate);
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

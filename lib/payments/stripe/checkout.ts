import { getStripeClient } from "./client";
import type { BookingPaymentRequest } from "../types";

// The platform's cut, per DEPLOYMENT — a single-practitioner brand sets
// COMMISSION_RATE=0 (the practitioner keeps 100%, the platform's revenue is a
// subscription rather than a cut), while the marketplace keeps the 0.15 default.
// Deployment-scope, not per-practitioner: read once at module load, same for
// every practitioner in this deployment. A malformed/negative value falls back
// to the default rather than silently charging a nonsense fee.
function resolveCommissionRate(): number {
  const raw = process.env.COMMISSION_RATE;
  if (raw === undefined || raw.trim() === "") return 0.15;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.15;
}

export const COMMISSION_RATE = resolveCommissionRate();

// Per-practitioner effective rate: the override when one is set (INCLUDING
// 0 — a founding-partner's genuine zero), otherwise the brand default.
// `?? COMMISSION_RATE` keeps an explicit 0 (nullish, not falsy). This is
// resolved server-side at booking time and snapshotted onto the payment
// (via session metadata → payments.commission_rate) so a later change to a
// practitioner's rate never alters what was already charged.
export function effectiveCommissionRate(override: number | null | undefined): number {
  return override ?? COMMISSION_RATE;
}

// The fee amount for a price at a given rate. Rate is now a parameter (the
// resolved per-practitioner effective rate), not the bare global — callers
// pass what effectiveCommissionRate() returned. Defaults to the brand rate
// so any legacy call without a rate still behaves as before.
export function commissionCentsFor(priceCents: number, rate: number = COMMISSION_RATE): number {
  return Math.round(priceCents * rate);
}

// Destination charge: a single Checkout Session creation both charges
// the client's card AND schedules the (price - commission) transfer to
// the practitioner's connected account — Stripe holds the commission
// back automatically, no separate transfer call needed. metadata is
// what the webhook (and the cron reconciliation sweep) use to recover
// which booking-to-be this session was for; nothing about the booking
// is trusted from anywhere else once payment is confirmed.
//
// expires_at is deliberately left unset — Stripe's real default is 24
// hours (its documented *minimum* if you set the field explicitly is
// 30 minutes, which is not the same thing as its default; worth being
// precise about, even though this project's own design makes the exact
// value inconsequential — no slot is held during Checkout either way,
// so a longer-lived link just means a longer-lived link, not a longer-
// blocked slot).
export async function createBookingCheckoutSession(
  request: BookingPaymentRequest,
  connectedAccountId: string,
  effectiveRate: number,
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const commissionCents = commissionCentsFor(request.priceCents, effectiveRate);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // No payment_method_types: omitting it makes a Checkout Session use the
    // methods enabled in the Stripe Dashboard (Settings -> Payment methods) —
    // Checkout's equivalent of automatic_payment_methods (which is a
    // PaymentIntent-level param, not a Checkout Session one). So a deployment
    // can enable Revolut Pay (wanted for the Bulgarian market), Apple/Google
    // Pay, etc. from the Dashboard with no code change. Checkout is a hosted
    // redirect flow, so redirect-based methods work out of the box.
    line_items: [
      {
        price_data: {
          currency: request.currency.toLowerCase(),
          product_data: { name: request.serviceName },
          unit_amount: request.priceCents,
        },
        quantity: 1,
      },
    ],
    // Separate charges & transfers: NO transfer_data here — the full amount
    // settles to the platform balance, and the practitioner's share is
    // transferred later by the payout-release sweep (lib/payments/stripe/
    // transfer.ts), after the hold window past session end. The commission is
    // simply never transferred (no application-fee object needed).
    metadata: {
      practitioner_id: request.practitionerId,
      client_id: request.clientId,
      service_id: request.serviceId,
      start_utc: request.startUtc,
      // Recorded for audit/debugging; the sweep re-reads the live connected
      // account from practitioner_profiles at release time.
      connected_account_id: connectedAccountId,
      // Snapshot carriers: the resolved rate and the exact fee charged, so
      // the webhook records what was actually applied rather than
      // recomputing from a rate that may have changed since.
      commission_rate: String(effectiveRate),
      commission_cents: String(commissionCents),
    },
    success_url: request.successPath,
    cancel_url: request.cancelPath,
  });

  if (!session.url) {
    // Only happens if Stripe's API contract changes out from under us —
    // mode: "payment" Sessions always get a url back in practice.
    throw new Error("Stripe Checkout Session created with no url");
  }

  return { sessionId: session.id, url: session.url };
}

// The immediate-booking counterpart: same destination charge, but the metadata
// carries immediate_request_id so the webhook branches to the off-grid booking
// path (create booking at the payment-clear moment, convert the hold, mark the
// request booked) instead of the scheduled confirm_paid_booking path.
export async function createImmediateCheckoutSession(
  input: {
    practitionerId: string;
    clientId: string;
    serviceId: string;
    serviceName: string;
    priceCents: number;
    currency: string;
    immediateRequestId: string;
    successPath: string;
    cancelPath: string;
  },
  connectedAccountId: string,
  effectiveRate: number,
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const commissionCents = commissionCentsFor(input.priceCents, effectiveRate);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: input.serviceName },
          unit_amount: input.priceCents,
        },
        quantity: 1,
      },
    ],
    // Separate charges & transfers: no transfer_data (see the scheduled path).
    metadata: {
      immediate_request_id: input.immediateRequestId,
      practitioner_id: input.practitionerId,
      client_id: input.clientId,
      service_id: input.serviceId,
      connected_account_id: connectedAccountId,
      // Same snapshot carriers as the scheduled path — the immediate
      // finalize (in the webhook) reads these to record the payments row.
      commission_rate: String(effectiveRate),
      commission_cents: String(commissionCents),
    },
    success_url: input.successPath,
    cancel_url: input.cancelPath,
  });

  if (!session.url) throw new Error("Stripe Checkout Session created with no url");
  return { sessionId: session.id, url: session.url };
}

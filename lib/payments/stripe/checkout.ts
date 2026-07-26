import { getStripeClient } from "./client";
import type { BookingPaymentRequest } from "../types";

// A setting, not a secret — fine as a plain constant (matches this
// codebase's convention for business-logic knobs like MAX_BIO_LENGTH,
// not something that needs env-var-level configurability). Change this
// one line to change the platform's cut everywhere at once.
export const COMMISSION_RATE = 0.15;

export function commissionCentsFor(priceCents: number): number {
  return Math.round(priceCents * COMMISSION_RATE);
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
): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeClient();
  const commissionCents = commissionCentsFor(request.priceCents);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
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
    payment_intent_data: {
      application_fee_amount: commissionCents,
      transfer_data: { destination: connectedAccountId },
    },
    metadata: {
      practitioner_id: request.practitionerId,
      client_id: request.clientId,
      service_id: request.serviceId,
      start_utc: request.startUtc,
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

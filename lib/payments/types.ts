// Model-agnostic shapes — nothing here mentions Stripe, Checkout, or
// Connect by name. lib/payments/index.ts is the only file outside
// lib/payments/stripe/ that's allowed to know a provider-specific detail
// exists at all, and even it only ever branches on BillingModel, never
// imports the Stripe SDK directly.

export type BillingModel = "commission" | "software_provider";

// What a caller needs to start a booking's payment. Deliberately NOT
// "a booking" — under the commission model no booking row exists yet
// (see lib/payments/index.ts's own top comment) — just what a future
// booking would need to become one once payment clears.
export type BookingPaymentRequest = {
  practitionerId: string;
  clientId: string;
  serviceId: string;
  startUtc: string;
  // For building a human-readable Checkout line item — never used for
  // pricing (that's always re-derived from services.price_cents
  // server-side, both here and again at confirmation time).
  serviceName: string;
  priceCents: number;
  currency: string;
  successPath: string; // app-relative path (locale-aware) to send the browser to after payment
  cancelPath: string;
};

export type InitiatePaymentResult =
  // commission model: hand the browser off to the provider's hosted
  // payment page. Nothing is booked yet.
  | { type: "redirect"; url: string }
  // software_provider model: no payment gate exists for this
  // practitioner — the caller should book immediately, exactly like
  // every booking before this epic.
  | { type: "no_payment_required" }
  // The provider call itself failed (network, missing API key, or Stripe
  // rejecting an otherwise-connected account). Logged loudly by the seam
  // before returning this — callers only need to show a clean "couldn't
  // start checkout" message, never a raw crash.
  | { type: "error" }
  // commission model, but the practitioner hasn't connected Stripe yet
  // or their account hasn't finished onboarding (charges_enabled is
  // false) — the normal state mid-onboarding, not a configuration error.
  // Distinct from "error" so the caller can show a specific, honest
  // message instead of a generic one.
  | { type: "practitioner_not_ready" };

export type RefundResult =
  | { refunded: true }
  // software_provider bookings were never paid through us — refunding
  // is a structural no-op, not an error.
  | { refunded: false; reason: "not_applicable" }
  | { refunded: false; reason: string };

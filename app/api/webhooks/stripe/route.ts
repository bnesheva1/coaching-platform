import { NextResponse } from "next/server";
import { verifyStripeWebhookEvent, handleCheckoutSessionCompleted } from "@/lib/payments/stripe/webhook";

// Deliberately thin — every decision lives in lib/payments/stripe/
// webhook.ts, this file only does the two things that genuinely belong
// to being a route handler: read the RAW body (request.text(), never
// request.json() — signature verification recomputes the signature
// over the exact bytes Stripe sent, so a parsed-and-re-serialized body
// would never match even for a real event) and translate the result
// into an HTTP response.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event;
  try {
    event = verifyStripeWebhookEvent(rawBody, signature);
  } catch (err) {
    // Anything that doesn't verify — wrong secret, tampered body, not
    // actually from Stripe — is rejected before touching the database
    // at all. Logged, not detailed in the response (no reason to help
    // an attacker iterate on a forged signature).
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      // No other event types are subscribed to — see
      // handleCheckoutSessionCompleted's own comment on why
      // checkout.session.expired needs no handler under this app's
      // book-on-successful-payment design.
      default:
        break;
    }
  } catch (err) {
    // A non-2xx response makes Stripe retry delivery later — the right
    // outcome for an unexpected failure (e.g. a transient DB error),
    // since confirm_paid_booking's own idempotency check makes a retry
    // safe rather than a duplicate.
    console.error("Stripe webhook handler failed", { eventType: event.type, err });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

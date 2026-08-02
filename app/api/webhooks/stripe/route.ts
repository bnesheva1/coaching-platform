import { NextResponse, after } from "next/server";
import {
  verifyStripeWebhookEvent,
  verifyStripeThinEvent,
  isThinEventPayload,
  handleCheckoutSessionCompleted,
} from "@/lib/payments/stripe/webhook";
import { handleAccountUpdated } from "@/lib/payments/stripe/connect";

// Deliberately thin — every decision lives in lib/payments/stripe/
// webhook.ts, this file only does the two things that genuinely belong
// to being a route handler: read the RAW body (request.text(), never
// request.json() — signature verification recomputes the signature
// over the exact bytes Stripe sent, so a parsed-and-re-serialized body
// would never match even for a real event) and translate the result
// into an HTTP response.
//
// Stripe only cares about the HTTP status: 2xx means "delivered,
// don't retry"; anything else means "retry later" (and repeated
// non-2xx responses are what gets an endpoint auto-disabled). Once the
// signature is verified, the event is genuinely from Stripe, so there
// is nothing left worth making Stripe retry over — confirm_paid_booking
// is idempotent, so a dropped/failed processing attempt is recovered by
// the cron reconciliation sweep, not by a Stripe redelivery. Processing
// therefore runs in `after()`, scheduled post-response: Stripe gets its
// 200 immediately after the signature check, and a slow or failing
// downstream call (DB, email) can never turn into a Stripe-visible
// non-2xx or a delivery timeout.
//
// This endpoint receives two genuinely different payload shapes: v1
// events (checkout.session.completed) and v2 "thin" events (Connect
// account capability updates) — confirmed live that Stripe's SDK
// rejects each shape when passed to the other's verify function.
// isThinEventPayload peeks at the body's own `object` field to route to
// the correct one; this grants no bypass, since whichever verifier
// actually runs still does the real cryptographic check.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const isThin = isThinEventPayload(rawBody);

  if (isThin) {
    let accountId: string;
    try {
      const notification = verifyStripeThinEvent(rawBody, signature);
      accountId = (notification as unknown as { related_object: { id: string } }).related_object.id;
    } catch (err) {
      console.error("Stripe thin-event signature verification failed", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    after(async () => {
      try {
        await handleAccountUpdated(accountId);
      } catch (err) {
        console.error("Stripe webhook handler failed", { accountId, err });
      }
    });

    return NextResponse.json({ received: true });
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

  after(async () => {
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
      // The response was already sent as 200 — this can no longer
      // become a Stripe-visible failure or retry. Logged loudly for
      // manual follow-up; the cron reconciliation sweep is the actual
      // safety net for a dropped event, not a Stripe redelivery.
      console.error("Stripe webhook handler failed", { eventType: event.type, err });
    }
  });

  return NextResponse.json({ received: true });
}

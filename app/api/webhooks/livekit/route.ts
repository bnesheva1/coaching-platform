import { NextResponse, after } from "next/server";
import { verifyAndNormaliseVideoEvent, persistVideoEvent } from "@/lib/video";

// Deliberately thin, exactly like app/api/webhooks/stripe/route.ts — the
// only route-handler-specific jobs are reading the RAW body (never
// request.json(): the signature is verified over the exact bytes sent, so
// a re-serialised body would fail even a genuine event) and mapping the
// result to an HTTP status.
//
// LiveKit signs webhook requests with the same API key/secret pair as the
// rest of the integration (there is no separate signing secret), and
// carries the signature JWT in the Authorization header. Verification
// happens synchronously BEFORE the response so a forged request is
// rejected with 400 without touching the database; the actual persistence
// runs in after(), post-response, so a slow/failing DB write can never
// become a LiveKit-visible non-2xx. A dropped event is recovered by the
// daily reconcile sweep, not by a provider redelivery — same safety-net
// design as the Stripe path.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const authHeader = request.headers.get("authorization");

  let normalised;
  try {
    normalised = await verifyAndNormaliseVideoEvent(rawBody, authHeader);
  } catch (err) {
    // Wrong key/secret, tampered body, not actually from LiveKit — rejected
    // before any DB access. Logged, not detailed in the response.
    console.error("LiveKit webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Verified, but an event type we don't record (track_published, egress,
  // etc.) — acknowledge without persisting.
  if (!normalised) {
    return NextResponse.json({ received: true });
  }

  after(async () => {
    try {
      await persistVideoEvent(normalised);
    } catch (err) {
      // The 200 was already sent — this can no longer become a
      // LiveKit-visible failure. Logged for follow-up; the reconcile sweep
      // is the real backstop for a dropped event.
      console.error("LiveKit webhook handler failed", { bookingId: normalised.bookingId, err });
    }
  });

  return NextResponse.json({ received: true });
}

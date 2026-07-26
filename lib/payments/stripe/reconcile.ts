import { getStripeClient } from "./client";
import { handleCheckoutSessionCompleted } from "./webhook";

// Wider than the daily cron interval — same "tolerant of an occasional
// missed/late run" reasoning as the reminder batch's own window (see
// lib/email/reminders.ts). The webhook is the primary confirmation
// path; this only exists to catch a payment whose webhook delivery was
// somehow never received at all (Stripe itself retries failed
// deliveries for a long time, so this is a rare-case backstop, not the
// expected way bookings get confirmed).
const LOOKBACK_HOURS = 48;

export type ReconcileResult = { sessionsChecked: number; sessionsProcessed: number };

// Deliberately reuses handleCheckoutSessionCompleted verbatim — not a
// parallel "reconcile" implementation. Its own first move is the
// stripe_checkout_session_id idempotency check inside
// confirm_paid_booking, so calling it again here for a session the
// webhook already handled is a clean no-op, not a double-booking or a
// double-charge: whichever of webhook/cron gets to a given session
// first wins, the other finds it already done.
export async function reconcilePaidCheckoutSessions(): Promise<ReconcileResult> {
  const stripe = getStripeClient();
  const createdAfter = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 60 * 60;

  let sessionsChecked = 0;
  let sessionsProcessed = 0;

  for await (const session of stripe.checkout.sessions.list({
    created: { gte: createdAfter },
    limit: 100,
  })) {
    if (session.payment_status !== "paid") continue;
    sessionsChecked++;
    try {
      await handleCheckoutSessionCompleted(session);
      sessionsProcessed++;
    } catch (err) {
      // Logged, not thrown further — one bad session shouldn't stop the
      // sweep from checking the rest of the batch. Next run tries again.
      console.error("reconcilePaidCheckoutSessions: failed to process session", { sessionId: session.id, err });
    }
  }

  return { sessionsChecked, sessionsProcessed };
}

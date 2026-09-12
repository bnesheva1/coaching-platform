import { getStripeClient } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { raiseAlert } from "@/lib/alerts";

// Hold window: the practitioner's share is transferred only this many hours
// after the session's scheduled end. 48h comfortably clears the daily no-show
// reconciliation (which resolves outcomes after the room closes at end_utc) plus
// a dispute/cancellation buffer. Env-overridable; resolved at module load like
// COMMISSION_RATE.
export const PAYOUT_HOLD_HOURS = Number(process.env.PAYOUT_HOLD_HOURS ?? "48") || 48;

type PaymentRow = {
  id: string;
  booking_id: string | null;
  amount_cents: number;
  commission_cents: number;
  currency: string;
  status: string;
  transfer_status: string;
  release_at: string | null;
  stripe_transfer_id: string | null;
  provider_ref: { payment_intent_id?: string } | null;
};

export type ReleaseResult = { released: boolean; reason?: string };

// Transfer a single booking's practitioner share to their connected account.
// Shared by the sweep and the admin "release now" action. Idempotent-ish: only
// acts on a succeeded, still-pending/held payment; anything else is a no-op.
// Never transfers while the practitioner's payouts are frozen. Raises a
// transfer_failed alert (same family as failed_refund) on a Stripe error.
export async function releaseBookingPayout(bookingId: string): Promise<ReleaseResult> {
  const supabase = createServiceRoleClient();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, booking_id, amount_cents, commission_cents, currency, status, transfer_status, release_at, stripe_transfer_id, provider_ref")
    .eq("booking_id", bookingId)
    .maybeSingle<PaymentRow>();
  if (!payment) return { released: false, reason: "no_payment" };
  if (payment.status !== "succeeded") return { released: false, reason: "not_succeeded" };
  if (!["pending", "held"].includes(payment.transfer_status)) return { released: false, reason: "already_" + payment.transfer_status };

  const { data: booking } = await supabase.from("bookings").select("practitioner_id").eq("id", bookingId).maybeSingle();
  if (!booking) return { released: false, reason: "no_booking" };

  const { data: prof } = await supabase
    .from("practitioner_profiles")
    .select("billing_model, stripe_connected_account_id, payouts_frozen")
    .eq("id", booking.practitioner_id as string)
    .maybeSingle();
  if (!prof || prof.billing_model !== "commission") {
    // Non-commission practitioners are never paid via transfers.
    await supabase.from("payments").update({ transfer_status: "not_applicable", updated_at: new Date().toISOString() }).eq("id", payment.id);
    return { released: false, reason: "not_commission" };
  }
  if (prof.payouts_frozen) return { released: false, reason: "payouts_frozen" };
  const destination = prof.stripe_connected_account_id as string | null;
  if (!destination) return { released: false, reason: "no_connected_account" };

  const shareCents = payment.amount_cents - payment.commission_cents;
  if (shareCents <= 0) {
    // Full commission (e.g. 100%) → nothing to transfer; the whole amount stays.
    await supabase.from("payments").update({ transfer_status: "released", updated_at: new Date().toISOString() }).eq("id", payment.id);
    return { released: true };
  }

  const paymentIntentId = payment.provider_ref?.payment_intent_id;
  if (!paymentIntentId) return { released: false, reason: "missing_payment_intent" };

  const stripe = getStripeClient();
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    // Ordering safety: if this charge ALREADY transferred to the connected
    // account (a legacy destination charge created before the cutover, or a
    // double-run), the share is already paid — mark released and never
    // double-pay. Makes the sweep safe regardless of migration/deploy order.
    if (pi.transfer_data || charge?.transfer) {
      await supabase.from("payments").update({ transfer_status: "released", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return { released: true };
    }
    const transfer = await stripe.transfers.create({
      amount: shareCents,
      currency: payment.currency.toLowerCase(),
      destination,
      // Draw from the specific settled charge (respects funds availability).
      ...(charge?.id ? { source_transaction: charge.id } : {}),
      metadata: { booking_id: bookingId },
    });
    await supabase
      .from("payments")
      .update({ transfer_status: "released", stripe_transfer_id: transfer.id, updated_at: new Date().toISOString() })
      .eq("id", payment.id);
    return { released: true };
  } catch (err) {
    // Same posture as a failed refund reversal — the practitioner is owed money
    // that didn't move. Loud alert for manual follow-up; the booking stays
    // pending so the next sweep retries.
    await raiseAlert({
      type: "transfer_failed",
      subject: bookingId,
      message: "A scheduled payout transfer to a practitioner's connected account failed.",
      context: { bookingId, paymentId: payment.id, destination, amountCents: shareCents, error: err instanceof Error ? err.message : String(err) },
      immediate: true,
    });
    return { released: false, reason: "transfer_error" };
  }
}

export type PayoutSweepSummary = {
  payoutsReleased: number;
  payoutsHeldFrozen: number;
  payoutsNotYetDue: number;
  payoutsFailed: number;
};

// Daily payout-release sweep (folded into the reminders cron; kept as a
// standalone function so it can move to its own more-frequent schedule on
// Vercel Pro without touching this logic). Releases every commission payout past
// its release time whose practitioner isn't frozen; backfills release_at; marks
// frozen-but-due as 'held'; and raises a low-balance alert if the platform
// balance can't cover what's owed.
export async function runPayoutReleaseSweep(): Promise<PayoutSweepSummary> {
  const supabase = createServiceRoleClient();
  const now = Date.now();
  const summary: PayoutSweepSummary = { payoutsReleased: 0, payoutsHeldFrozen: 0, payoutsNotYetDue: 0, payoutsFailed: 0 };

  const { data: candidates } = await supabase
    .from("payments")
    .select("id, booking_id, amount_cents, commission_cents, transfer_status, release_at")
    .eq("status", "succeeded")
    .in("transfer_status", ["pending", "held"]);
  const rows = candidates ?? [];
  if (rows.length === 0) return summary;

  const bookingIds = rows.map((r) => r.booking_id).filter(Boolean) as string[];
  const { data: bookings } = await supabase.from("bookings").select("id, end_utc, practitioner_id").in("id", bookingIds);
  const bookingById = new Map((bookings ?? []).map((b) => [b.id as string, b]));
  const pracIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id as string))];
  const { data: pracs } = await supabase.from("practitioner_profiles").select("id, billing_model, payouts_frozen").in("id", pracIds);
  const pracById = new Map((pracs ?? []).map((p) => [p.id as string, p]));

  let owedNow = 0; // total practitioner share of everything due-and-releasable, for the balance check

  for (const r of rows) {
    const booking = r.booking_id ? bookingById.get(r.booking_id) : null;
    if (!booking) continue; // orphan (no booking) — leave for the alert sweep
    const prof = pracById.get(booking.practitioner_id as string);
    if (!prof || prof.billing_model !== "commission") {
      await supabase.from("payments").update({ transfer_status: "not_applicable", updated_at: new Date().toISOString() }).eq("id", r.id);
      continue;
    }

    // Backfill the scheduled release time on first sight (session end + hold).
    let releaseAt = r.release_at ? new Date(r.release_at).getTime() : null;
    if (releaseAt === null) {
      releaseAt = new Date(booking.end_utc as string).getTime() + PAYOUT_HOLD_HOURS * 3_600_000;
      await supabase.from("payments").update({ release_at: new Date(releaseAt).toISOString() }).eq("id", r.id);
    }

    if (now < releaseAt) {
      summary.payoutsNotYetDue++;
      continue;
    }
    if (prof.payouts_frozen) {
      // Past due but withheld — surface as 'held' so admins see why.
      if (r.transfer_status !== "held") await supabase.from("payments").update({ transfer_status: "held" }).eq("id", r.id);
      summary.payoutsHeldFrozen++;
      continue;
    }

    owedNow += r.amount_cents - r.commission_cents;
    const res = await releaseBookingPayout(r.booking_id as string);
    if (res.released) summary.payoutsReleased++;
    else summary.payoutsFailed++;
  }

  // Low-balance guard: if the platform's available balance can't cover what we
  // just tried to release, transfers will start failing — alert loudly. Best-
  // effort; a balance-read hiccup must not fail the sweep.
  if (owedNow > 0) {
    try {
      const stripe = getStripeClient();
      const balance = await stripe.balance.retrieve();
      const available = balance.available.reduce((sum, b) => sum + b.amount, 0);
      if (available < owedNow) {
        await raiseAlert({
          type: "platform_balance_low",
          subject: "payout-release",
          message: "Platform Stripe balance is below the payouts owed for release — transfers may fail.",
          context: { availableCents: available, owedCents: owedNow },
          immediate: true,
        });
      }
    } catch (err) {
      console.error("runPayoutReleaseSweep: balance check failed", err);
    }
  }

  return summary;
}

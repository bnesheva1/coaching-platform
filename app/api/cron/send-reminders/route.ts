import { NextResponse } from "next/server";
import { sendReminderBatch } from "@/lib/email/reminders";
import { completePastBookings } from "@/lib/bookings/completePastBookings";
import { reconcilePaidCheckoutSessions } from "@/lib/payments/stripe/reconcile";
import { reconcileVideoRooms } from "@/lib/video/reconcile";
import { runAlertSweep } from "@/lib/alerts/sweep";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// Vercel's standard cron-protection mechanism: set CRON_SECRET as an
// env var (locally AND in the Vercel project dashboard — Vercel's
// scheduler runs in their infrastructure, not this app's, so it reads
// the secret from its own config to attach this header). Vercel
// automatically sends `Authorization: Bearer <CRON_SECRET>` on every
// invocation it makes to a configured cron route. Anyone hitting this
// URL directly without that exact header is rejected before any data
// is touched — only Vercel's own scheduler knows the secret.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Fail closed if CRON_SECRET isn't configured at all — without this
  // check, an unset env var would make the comparison below match the
  // literal string "Bearer undefined", which is a genuine bypass, not
  // just a hypothetical one.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reconciliation runs first, ahead of completion — it's the one step
  // that can CREATE a booking row (a payment whose webhook never
  // arrived), so running it first means a newly-recovered booking is
  // already reflected in state for this same invocation's completion/
  // reminder passes, not just next run. Completion then reminders is
  // the existing ordering: disjoint booking sets (past vs. a future
  // 12-36h window), no interaction risk either way, but keeps a
  // booking that just completed visible to the rest of this run.
  const reconciliationResult = await reconcilePaidCheckoutSessions();
  const completionResult = await completePastBookings();
  const reminderResult = await sendReminderBatch();
  // Video runaway-billing backstop, folded into the same daily job (Vercel
  // Hobby = daily-only; see VIDEO_CONFIG.ROOM_CLOSE_SAFETY_MARGIN_MINUTES).
  // Force-closes any room open past its window and resolves no-show
  // outcomes for closed-but-unresolved sessions — the reconcile analog to
  // the Stripe sweep above, and independent of any LiveKit webhook.
  const videoResult = await reconcileVideoRooms();
  // Alert sweep runs LAST, after reconciliation has recovered what it can (a
  // paid session's missing booking, an unresolved outcome) — so it only flags
  // what's genuinely still broken, not what this same run just fixed. Called
  // as a standalone function (its own schedule config lives in lib/alerts/
  // sweep.ts): Vercel Hobby allows one daily cron, so it folds in here; on a
  // paid plan, give it its own tighter cron and delete this one line.
  const alertResult = await runAlertSweep();

  const summary = { ...reconciliationResult, ...completionResult, ...reminderResult, ...videoResult, ...alertResult };

  // Heartbeat: record that this run happened, so the admin health page can tell
  // a stopped cron from a quiet one. Best-effort and LAST — a heartbeat write
  // failure must never fail the run whose real work already completed above.
  try {
    await createServiceRoleClient().from("cron_runs").insert({ summary });
  } catch (err) {
    console.error("cron heartbeat write failed", err);
  }

  return NextResponse.json(summary);
}

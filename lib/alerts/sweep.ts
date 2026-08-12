import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { provider } from "@/lib/email/shared";
import { AlertDigestEmail } from "@/lib/email/templates/AlertDigestEmail";
import { raiseAlert, pushToAdapters } from "./index";
import type { Alert } from "./types";

// Schedule config lives WITH the sweep because the daily-cron limit shaped the
// design. Vercel Hobby allows one cron, once daily (see
// app/api/cron/send-reminders/route.ts), so this runs inside that job. On a
// paid plan, promoting it to a tighter cron is: add a vercel.json entry hitting
// a route that calls runAlertSweep(), and remove the call from the daily cron —
// no refactor. The grace windows below are deliberately generous BECAUSE the
// sweep is up to 24h behind on Hobby; shorten them alongside a tighter cron.
export const ALERT_SWEEP_CONFIG = {
  unresolvedGraceMinutes: 60, // let reconcileVideoRooms resolve first
  sessionFailedGraceMinutes: 30,
  mismatchGraceMinutes: 30, // let reconcilePaidCheckoutSessions recover first
  webhookWindowMinutes: 24 * 60, // "repeated" measured over the daily window on Hobby
  webhookThreshold: 3,
};

// Sweep-found alerts are NEVER immediate — this whole function runs in the daily
// batch, so a critical it finds is up to 24h stale and is delivered by
// deliverPendingAlerts (digest + a batched, non-immediate push), never routed
// as "immediate". Inline raise points are the ones that reach Telegram at once.
export async function runAlertSweep(): Promise<{
  unresolvedOutcomes: number;
  sessionFailed: number;
  paymentMismatches: number;
  webhookRepeats: number;
  digested: number;
}> {
  const unresolvedOutcomes = await sweepUnresolvedOutcomes();
  const sessionFailed = await sweepSessionFailed();
  const paymentMismatches = await sweepPaymentBookingMismatches();
  const webhookRepeats = await sweepRepeatedWebhookFailures();
  const { digested } = await deliverPendingAlerts();
  return { unresolvedOutcomes, sessionFailed, paymentMismatches, webhookRepeats, digested };
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// A session past its window with a null outcome that DID open / got a room —
// the resolver never finished. (Never-provisioned rooms are session_failed
// below; splitting them keeps the two from double-alerting the same session.)
async function sweepUnresolvedOutcomes(): Promise<number> {
  const supabase = createServiceRoleClient();
  const cutoff = isoMinutesAgo(ALERT_SWEEP_CONFIG.unresolvedGraceMinutes);
  const { data } = await supabase
    .from("video_sessions")
    .select("booking_id, closes_at, status, room_created_at")
    .is("outcome", null)
    .lt("closes_at", cutoff);
  const stuck = (data ?? []).filter((s) => s.room_created_at !== null || s.status !== "scheduled");
  for (const s of stuck) {
    await raiseAlert({
      type: "unresolved_outcome",
      subject: s.booking_id as string,
      message: "Session is past its window with outcome still null.",
      context: { bookingId: s.booking_id, closesAt: s.closes_at, status: s.status },
    });
  }
  return stuck.length;
}

// A session whose window passed but no room was ever created and it never
// opened or resolved — provisioning never happened at the platform level.
async function sweepSessionFailed(): Promise<number> {
  const supabase = createServiceRoleClient();
  const cutoff = isoMinutesAgo(ALERT_SWEEP_CONFIG.sessionFailedGraceMinutes);
  const { data } = await supabase
    .from("video_sessions")
    .select("booking_id, closes_at")
    .is("outcome", null)
    .is("room_created_at", null)
    .eq("status", "scheduled")
    .lt("closes_at", cutoff);
  for (const s of data ?? []) {
    await raiseAlert({
      type: "session_failed",
      subject: s.booking_id as string,
      message: "Video room never provisioned — the session's window passed with no room created.",
      context: { bookingId: s.booking_id, closesAt: s.closes_at },
    });
  }
  return (data ?? []).length;
}

// A succeeded payment with no booking. booking_id is nullable exactly for this
// case (see the payments migration). reconcilePaidCheckoutSessions runs earlier
// in the cron and recovers what it can from Stripe; anything still unlinked
// here is a genuine, unrecovered mismatch — a client paid and got nothing.
async function sweepPaymentBookingMismatches(): Promise<number> {
  const supabase = createServiceRoleClient();
  const cutoff = isoMinutesAgo(ALERT_SWEEP_CONFIG.mismatchGraceMinutes);
  const { data } = await supabase
    .from("payments")
    .select("id, amount_cents, currency, created_at")
    .eq("status", "succeeded")
    .is("booking_id", null)
    .lt("created_at", cutoff);
  for (const p of data ?? []) {
    await raiseAlert({
      type: "payment_booking_mismatch",
      subject: p.id as string,
      message: "A payment succeeded with no confirmed booking.",
      context: { paymentId: p.id, amount: `${((p.amount_cents as number) / 100).toFixed(2)} ${p.currency}` },
    });
  }
  return (data ?? []).length;
}

// Backstop for the inline webhook-failure counter: if a source logged repeated
// failures in the window, raise (deduped per source). Inline raising handles
// the real-time case; this catches a burst the inline path might have missed.
async function sweepRepeatedWebhookFailures(): Promise<number> {
  const supabase = createServiceRoleClient();
  const cutoff = isoMinutesAgo(ALERT_SWEEP_CONFIG.webhookWindowMinutes);
  let raised = 0;
  for (const source of ["stripe", "livekit"] as const) {
    const { count } = await supabase
      .from("webhook_failures")
      .select("id", { count: "exact", head: true })
      .eq("source", source)
      .gte("created_at", cutoff);
    if ((count ?? 0) >= ALERT_SWEEP_CONFIG.webhookThreshold) {
      await raiseAlert({
        type: "webhook_failure",
        subject: source,
        message: `${count} ${source} webhook failures in the last ${Math.round(ALERT_SWEEP_CONFIG.webhookWindowMinutes / 60)}h.`,
        context: { source, count },
      });
      raised++;
    }
  }
  return raised;
}

// The daily batch delivery: everything recorded but not yet notified
// (last_notified_at null) — inline warnings, plus every sweep-found alert.
// One digest email via the Resend seam, a batched (NOT immediate) push of any
// criticals to the adapters, then stamp last_notified_at so a persistent alert
// is notified once and stays quiet until it changes or is dismissed.
export async function deliverPendingAlerts(): Promise<{ digested: number }> {
  const supabase = createServiceRoleClient();
  const { data: pending } = await supabase
    .from("alerts")
    .select("id, type, subject, severity, message, context, first_seen_at")
    .eq("status", "active")
    .is("last_notified_at", null)
    .order("first_seen_at", { ascending: false });
  if (!pending || pending.length === 0) return { digested: 0 };

  // Batched push of criticals the sweep found (delayed, never "immediate").
  for (const a of pending) {
    if (a.severity === "critical") {
      await pushToAdapters({
        type: a.type as Alert["type"],
        severity: "critical",
        subject: a.subject as string,
        message: a.message as string,
        context: (a.context as Record<string, unknown>) ?? {},
      });
    }
  }

  // Digest email to the ops inbox (reuses CONTACT_SUPPORT_EMAIL). Skipped, not
  // failed, when no inbox is configured.
  const to = process.env.CONTACT_SUPPORT_EMAIL;
  if (to) {
    const result = await provider.send({
      to,
      subject: `[alerts] ${pending.length} need attention`,
      react: AlertDigestEmail({
        items: pending.map((a) => ({
          severity: a.severity as string,
          type: a.type as string,
          message: a.message as string,
          when: new Date(a.first_seen_at as string).toISOString(),
          context: Object.entries((a.context as Record<string, unknown>) ?? {})
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n"),
        })),
      }),
    });
    if (!result.success) console.error("alert digest email failed", { error: result.error });
  }

  await supabase
    .from("alerts")
    .update({ last_notified_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((a) => a.id),
    );
  return { digested: pending.length };
}

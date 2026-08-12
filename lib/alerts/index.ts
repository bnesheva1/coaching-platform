import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getAdapters } from "./adapters";
import { ALERT_TYPES, type Alert, type AlertSeverity, type AlertType } from "./types";

export { ALERT_TYPES } from "./types";
export type { Alert, AlertSeverity, AlertType, AlertAdapter } from "./types";

// Severity -> channels. Declarative config, not scattered if/else — reroute a
// severity by editing this table. Every severity ALWAYS records to the
// dashboard (the alerts table); this only governs push/digest on top of that.
export const SEVERITY_ROUTING: Record<AlertSeverity, { push: boolean; digest: boolean }> = {
  critical: { push: true, digest: false }, // -> adapters (Telegram), but only when raised immediate (see below)
  warning: { push: false, digest: true }, // -> dashboard + the daily digest email
  info: { push: false, digest: false }, // -> dashboard only
};

// The meaningful state of an alert, for dedupe. Same (type, subject) with the
// same fingerprint = the same condition; a changed fingerprint = it changed.
function fingerprintOf(message: string, context: Record<string, unknown>): string {
  const keys = Object.keys(context).sort();
  return `${message}::${JSON.stringify(context, keys)}`;
}

// THE entry point. Call sites say what happened and how urgent — never how
// it's delivered. Never throws (best-effort, like the email seam): a failure
// to record/deliver an alert must not fail the action that raised it.
//
// `immediate` is a property of the RAISE, not the severity: inline raise points
// (a refund throwing, a webhook erroring) set it true, so a critical reaches
// Telegram right away. Sweep-found alerts NEVER set it — they run in the daily
// cron and are up to 24h behind, so they can't be immediate regardless of
// severity; they're delivered by the daily batch (see sweep.ts / deliverPendingAlerts).
export async function raiseAlert(input: {
  type: AlertType;
  subject: string;
  message: string;
  context?: Record<string, unknown>;
  severity?: AlertSeverity;
  immediate?: boolean;
}): Promise<void> {
  try {
    const severity = input.severity ?? ALERT_TYPES[input.type].severity;
    const context = input.context ?? {};
    const fingerprint = fingerprintOf(input.message, context);
    const now = new Date().toISOString();
    const supabase = createServiceRoleClient();

    const { data: existing } = await supabase
      .from("alerts")
      .select("id, status, fingerprint")
      .eq("type", input.type)
      .eq("subject", input.subject)
      .maybeSingle();

    // Dedupe: notify on a NEW (type,subject) or a CHANGED fingerprint (incl.
    // re-activating a dismissed one that changed). An unchanged active/dismissed
    // condition just touches last_seen_at and stays quiet — this is what stops
    // "the same three unresolved sessions, every day, forever".
    let notify: boolean;
    if (!existing) {
      await supabase.from("alerts").insert({
        type: input.type,
        subject: input.subject,
        severity,
        message: input.message,
        context,
        fingerprint,
        status: "active",
        last_seen_at: now,
      });
      notify = true;
    } else if (existing.fingerprint !== fingerprint) {
      await supabase
        .from("alerts")
        .update({
          severity,
          message: input.message,
          context,
          fingerprint,
          status: "active",
          dismissed_at: null,
          dismissed_by: null,
          last_notified_at: null, // pending re-notification since it changed
          last_seen_at: now,
        })
        .eq("id", existing.id);
      notify = true;
    } else {
      await supabase.from("alerts").update({ last_seen_at: now }).eq("id", existing.id);
      notify = false;
    }

    if (!notify) return;

    // Immediate push: only when the RAISE was immediate AND the severity routes
    // to push. Otherwise last_notified_at stays null and the daily batch
    // (deliverPendingAlerts) picks it up — a sweep-found critical is delivered
    // by the batch, never "immediately".
    if (input.immediate && SEVERITY_ROUTING[severity].push) {
      await pushToAdapters({ type: input.type, severity, subject: input.subject, message: input.message, context });
      await supabase
        .from("alerts")
        .update({ last_notified_at: now })
        .eq("type", input.type)
        .eq("subject", input.subject);
    }
  } catch (error) {
    console.error("raiseAlert failed", { type: input.type, subject: input.subject, error });
  }
}

// Deliver one alert to every configured adapter, in parallel; one adapter
// failing never blocks the others (or, upstream, the caller).
export async function pushToAdapters(alert: Alert): Promise<void> {
  const adapters = getAdapters();
  await Promise.all(
    adapters.map((a) =>
      a.deliver(alert).catch((err) => console.error(`alert adapter "${a.name}" failed`, { type: alert.type, err })),
    ),
  );
}

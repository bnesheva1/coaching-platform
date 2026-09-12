import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { pushAdaptersEnabled } from "@/lib/alerts/pushGate";

// Telegram admin-activity tripwire. Deliberately separate from the lib/alerts
// health-alert seam (which dedupes and records to the alerts table) — these are
// an event stream, one message per event, no dedupe.
//
// Every path here is FAIL-SAFE: a missing config, a bad token, a network error
// or a timeout is caught, logged server-side (never the token), and swallowed —
// so an admin login or action is never blocked or broken by an alert failure.
//
// The bot token lives only in the request URL and is never logged: on failure we
// log the HTTP status or the error NAME only, never the error message/stack
// (which could carry the URL) and never the token itself.

const SEND_TIMEOUT_MS = 5000;

async function sendTelegram(text: string): Promise<void> {
  // Production-only push, same gate as the alerts adapters — dev/test/preview
  // never page the live channel (a first-seen-device tripwire in dev is noise).
  if (!pushAdaptersEnabled()) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // Not configured → skip silently (same posture as the alerts telegram adapter).
  if (!token || !chatId) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("admin-activity alert: Telegram responded non-2xx", { status: res.status });
    }
  } catch (e) {
    console.error("admin-activity alert: send failed", { name: (e as Error)?.name ?? "Error" });
  } finally {
    clearTimeout(timer);
  }
}

// Telegram HTML parse_mode: escape the three special chars in any dynamic value.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function actorLabel(email: string | null, id: string): string {
  return email ? esc(email) : `id ${esc(id.slice(0, 8))}`;
}

// ── Sensitive admin actions (the deliberately short tripwire set) ──────────────
// Approval/rejection (moderation), price/fee changes (commission, subscription),
// and refund/payout (payout freeze/release, bulk cancel + refund). Everything
// else that flows through recordAdminAction (dashboard-alert dismiss, feature
// flags) is intentionally NOT alerted — this is a tripwire, not a firehose.
const TRIPWIRE_PREFIXES = [
  "practitioner.moderation",
  "practitioner.commission",
  "practitioner.subscription",
  "practitioner.payouts",
  "practitioner.bulk_cancel",
] as const;

export function isTripwireAction(action: string): boolean {
  return TRIPWIRE_PREFIXES.some((p) => action.startsWith(p));
}

// Minimal body: what (action), who (admin), which record (practitioner id), when.
// Deliberately omits the previous/new values and the admin's free-text reason —
// those stay in admin_audit_log; the alert carries no PII beyond the record id.
export async function alertAdminAction(entry: {
  actorId: string;
  actorEmail: string | null;
  action: string;
  targetId?: string | null;
}): Promise<void> {
  const lines = [
    "<b>⚠️ Admin action</b>",
    `Action: ${esc(entry.action)}`,
    `Admin: ${actorLabel(entry.actorEmail, entry.actorId)}`,
  ];
  if (entry.targetId) lines.push(`Practitioner: ${esc(entry.targetId)}`);
  lines.push(`When: ${new Date().toISOString()}`);
  await sendTelegram(lines.join("\n"));
}

// ── Admin login ────────────────────────────────────────────────────────────────
// Records the (admin, ip, user-agent) event and flags when the IP or the device
// is first-seen for this admin. If the tracking table isn't there yet or the DB
// call fails, the alert still fires — just without reliable first-seen detection.
export async function recordAdminLogin(input: {
  adminId: string;
  adminEmail: string | null;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  const { adminId, adminEmail, ip, userAgent } = input;
  let firstSeen = false;
  try {
    const db = createServiceRoleClient();
    const { data: ipRows } = await db
      .from("admin_login_events")
      .select("id")
      .eq("admin_id", adminId)
      .eq("ip", ip)
      .limit(1);
    const ipSeen = (ipRows?.length ?? 0) > 0;

    let uaSeen = true; // unknown UA → don't flag on device
    if (userAgent) {
      const { data: uaRows } = await db
        .from("admin_login_events")
        .select("id")
        .eq("admin_id", adminId)
        .eq("user_agent", userAgent)
        .limit(1);
      uaSeen = (uaRows?.length ?? 0) > 0;
    }
    firstSeen = !ipSeen || !uaSeen;

    await db.from("admin_login_events").insert({ admin_id: adminId, ip, user_agent: userAgent });
  } catch (e) {
    console.error("admin login tracking failed", { name: (e as Error)?.name ?? "Error" });
  }

  const lines = [
    `<b>🔐 Admin login</b>${firstSeen ? " — <b>⚠️ NEW IP/device</b>" : ""}`,
    `Admin: ${actorLabel(adminEmail, adminId)}`,
    `IP: ${esc(ip)}`,
  ];
  if (userAgent) lines.push(`Device: ${esc(userAgent.slice(0, 180))}`);
  lines.push(`When: ${new Date().toISOString()}`);
  await sendTelegram(lines.join("\n"));
}

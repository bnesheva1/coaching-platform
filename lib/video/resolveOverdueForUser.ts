import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { resolveVideoAttendance } from "./attendance";

// Cron-independent resolution backstop, run when a party views their
// sessions. Resolves any of the user's OVERDUE sessions whose outcome is
// still NULL, so the display is never built on an unresolved session.
//
// Why it's needed: outcomes normally resolve via the room_finished webhook
// (real-time, for any room that was actually created) or the daily cron
// sweep. But a no-show where NOBODY joins never creates a room, so no
// webhook ever fires — those sessions depend entirely on the cron, and if
// the cron is delayed or down they stay NULL indefinitely. Resolving on
// read closes that gap regardless of the cron's health.
//
// Idempotent: resolveVideoAttendance is a no-op once the outcome is set,
// and refundBookingPayment is a no-op once refunded / when nothing was
// paid. Bounded to the user's own bookings. Errors are swallowed so this
// can never break the page it runs on.
export async function resolveOverdueSessionsForUser(userId: string): Promise<void> {
  const admin = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select("id")
    .or(`client_id.eq.${userId},practitioner_id.eq.${userId}`);
  const bookingIds = (bookings ?? []).map((b) => b.id);
  if (bookingIds.length === 0) return;

  const { data: sessions } = await admin
    .from("video_sessions")
    .select("id, status")
    .is("outcome", null)
    .lt("closes_at", nowIso)
    .in("booking_id", bookingIds);

  for (const s of sessions ?? []) {
    try {
      // resolveVideoAttendance only acts on a CLOSED session; a
      // room-never-created no-show is still 'scheduled', so close it first
      // (nothing to close on the provider — no room was ever made).
      if (s.status !== "closed") {
        await admin.from("video_sessions").update({ status: "closed" }).eq("id", s.id);
      }
      await resolveVideoAttendance(s.id);
    } catch (err) {
      console.error("resolveOverdueSessionsForUser: resolve failed", { sessionId: s.id, err });
    }
  }
}

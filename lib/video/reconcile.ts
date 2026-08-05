import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { VIDEO_CONFIG } from "./config";
import { closeRoom } from "./livekit/rooms";
import { resolveVideoAttendance } from "./attendance";

export type VideoReconcileResult = {
  roomsSwept: number;
  roomsClosed: number;
  attendanceResolved: number;
};

// The runaway-billing backstop, meant to be folded into the existing
// DAILY send-reminders cron (Vercel Hobby = daily only; see
// VIDEO_CONFIG.ROOM_CLOSE_SAFETY_MARGIN_MINUTES for the free-tier
// compromise this reflects). Two idempotent, re-runnable jobs — the same
// "reconcile sweep backstops the webhook" shape as
// reconcilePaidCheckoutSessions does for Stripe:
//
//   1. Force-close any session still open past closes_at + margin, so a
//      missed room_finished webhook never leaves a room billing.
//   2. Resolve attendance/outcome for any closed-but-unresolved session,
//      backstopping a dropped webhook and triggering no-show refunds.
//
// NEXT SLICE: add `await reconcileVideoRooms()` to
// app/api/cron/send-reminders/route.ts. Deliberately not wired yet — no
// video_sessions exist until the booking-flow slice creates them, so
// there's nothing for it to do until then.
export async function reconcileVideoRooms(): Promise<VideoReconcileResult> {
  const supabase = createServiceRoleClient();
  const staleBefore = new Date(
    Date.now() - VIDEO_CONFIG.ROOM_CLOSE_SAFETY_MARGIN_MINUTES * 60_000,
  ).toISOString();

  let roomsSwept = 0;
  let roomsClosed = 0;

  // 1. Overdue-but-still-open sessions.
  const { data: overdue } = await supabase
    .from("video_sessions")
    .select("id, booking_id")
    .in("status", ["scheduled", "open"])
    .lt("closes_at", staleBefore);

  for (const s of overdue ?? []) {
    roomsSwept++;
    try {
      await closeRoom(s.booking_id); // idempotent; no-op if already gone
      await supabase.from("video_sessions").update({ status: "closed" }).eq("id", s.id);
      roomsClosed++;
    } catch (err) {
      console.error("reconcileVideoRooms: close failed", { bookingId: s.booking_id, err });
    }
  }

  // 2. Closed-but-unresolved sessions.
  const { data: unresolved } = await supabase
    .from("video_sessions")
    .select("id")
    .eq("status", "closed")
    .is("outcome", null);

  let attendanceResolved = 0;
  for (const s of unresolved ?? []) {
    try {
      await resolveVideoAttendance(s.id);
      attendanceResolved++;
    } catch (err) {
      console.error("reconcileVideoRooms: resolve failed", { videoSessionId: s.id, err });
    }
  }

  return { roomsSwept, roomsClosed, attendanceResolved };
}

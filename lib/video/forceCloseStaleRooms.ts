import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getRoomServiceClient } from "./livekit/client";
import { closeRoom } from "./livekit/rooms";

export type ForceCloseRoomsResult = {
  openRooms: number;
  closed: { room: string; participants: number; reason: string }[];
  skipped: { room: string; participants: number; reason: string }[];
};

// On-demand, cron-independent sweep of leaked LiveKit rooms.
//
// Unlike the daily reconcile sweep, this lists rooms directly on the
// PROVIDER (not via video_sessions), so it also catches ORPHAN rooms — a
// room whose booking/session was deleted, or that outlived its DB record —
// which the DB-driven sweep can never see (that's the exact gap that let a
// room sit open for 55 minutes).
//
// Closes a room when its session window has passed, or when it's an orphan
// with nobody in it. Leaves alone: rooms still inside their window, and
// orphan rooms that somehow still have participants (surfaced for manual
// review rather than kicking an unknown live call).
export async function forceCloseStaleRooms(): Promise<ForceCloseRoomsResult> {
  const supabase = createServiceRoleClient();
  const service = getRoomServiceClient();
  const rooms = await service.listRooms();
  const now = Date.now();

  const closed: ForceCloseRoomsResult["closed"] = [];
  const skipped: ForceCloseRoomsResult["skipped"] = [];

  for (const room of rooms) {
    const participants = room.numParticipants ?? 0;

    // room.name is the booking id (server-set at createRoom).
    const { data: vs } = await supabase
      .from("video_sessions")
      .select("closes_at")
      .eq("booking_id", room.name)
      .maybeSingle();

    let reason: string;
    if (!vs) {
      if (participants > 0) {
        skipped.push({ room: room.name, participants, reason: "orphan room with participants — left for manual review" });
        continue;
      }
      reason = "orphan room (no video_session), empty";
    } else if (new Date(vs.closes_at).getTime() < now) {
      reason = `past its close time (${vs.closes_at})`;
    } else {
      skipped.push({ room: room.name, participants, reason: "still within its session window" });
      continue;
    }

    // closeRoom (deleteRoom) swallows its own "already gone" errors and
    // never throws, so one bad room can't abort the sweep.
    await closeRoom(room.name);
    if (vs) await supabase.from("video_sessions").update({ status: "closed" }).eq("booking_id", room.name);
    closed.push({ room: room.name, participants, reason });
  }

  return { openRooms: rooms.length, closed, skipped };
}

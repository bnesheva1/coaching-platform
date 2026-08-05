import type { WebhookEvent } from "livekit-server-sdk";
import type { NormalisedAttendanceEvent, VideoAttendanceEventType } from "../types";

// LiveKit event name -> our own vocabulary. Anything absent from this map
// (track_published, egress_*, ingress_*, participant_connection_aborted,
// etc.) is intentionally dropped — we record only room lifecycle +
// participant presence, the minimum the no-show rules need.
const EVENT_TYPE_MAP: Record<string, VideoAttendanceEventType> = {
  room_started: "room_opened",
  room_finished: "room_closed",
  participant_joined: "participant_joined",
  participant_left: "participant_left",
};

// Pure transform: LiveKit payload -> our neutral event shape. No DB
// access — participant ROLE is deliberately not resolved here (that needs
// our booking data); the persist step in the seam fills it in.
export function normaliseLiveKitEvent(event: WebhookEvent): NormalisedAttendanceEvent | null {
  const eventType = EVENT_TYPE_MAP[event.event];
  if (!eventType) return null;

  // room.name is what we set at createRoom = the booking id.
  const bookingId = event.room?.name;
  if (!bookingId) return null;

  // participant.identity is what we set at token issue = profiles.id.
  const participantId = event.participant?.identity ?? null;

  // createdAt is a protobuf int64 (bigint) unix-seconds value; id is
  // LiveKit's unique event id, which is our dedup key.
  const occurredAt = event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date();

  return { bookingId, eventType, participantId, occurredAt, providerEventId: event.id };
}

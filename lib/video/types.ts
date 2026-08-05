// Provider-agnostic domain shapes — nothing here names LiveKit. The
// VideoProvider interface below is the ENTIRE provider contract; the
// no-show/refund rules (lib/video/attendance.ts) and everything else in
// the app sit on top of this and our own DB tables, so swapping providers
// means rewriting lib/video/livekit/ and nothing else. Mirrors the intent
// of lib/payments/types.ts.

export type VideoParticipantRole = "client" | "practitioner";

// Our own event vocabulary. A provider's richer event set (track
// published, egress, etc.) is deliberately collapsed to just the room
// lifecycle + participant presence the no-show rules need.
export type VideoAttendanceEventType =
  | "room_opened"
  | "participant_joined"
  | "participant_left"
  | "room_closed";

// The normalised core of a provider event. participantRole is NOT here on
// purpose: it's resolved at persist time by comparing participantId to the
// booking's own parties (our data), keeping normalisation a pure,
// DB-free transform.
export type NormalisedAttendanceEvent = {
  bookingId: string;
  eventType: VideoAttendanceEventType;
  participantId: string | null;
  occurredAt: Date;
  providerEventId: string;
};

export type CreateRoomInput = {
  bookingId: string; // room name is derived from this server-side; never client-supplied
  maxParticipants: number;
  emptyTimeoutSeconds: number;
};

export type VideoRoomHandle = {
  providerRoomName: string;
  providerRoomSid: string;
};

export type JoinCredentialInput = {
  bookingId: string;
  participantId: string; // = profiles.id; ties webhook events back to a user
  participantRole: VideoParticipantRole;
  displayName: string;
  // Upper bound on token validity = the session's closes_at. LiveKit has
  // no "not before" claim, so the LOWER bound (opens_at) is enforced by
  // the seam refusing to mint a token before the window — see index.ts.
  expiresAt: Date;
};

export type JoinCredential = {
  token: string;
  url: string;
  expiresAt: Date;
};

export interface VideoProvider {
  // Server-side room creation. The room name is always derived from the
  // booking id inside the implementation; a caller can't name a room.
  createRoom(input: CreateRoomInput): Promise<VideoRoomHandle>;

  // A fresh, time-limited join credential scoped to one booking's room.
  // Never stored; minted per join request.
  issueJoinCredential(input: JoinCredentialInput): Promise<JoinCredential>;

  // Force-close a room. Idempotent from the caller's perspective (closing
  // an already-gone room is not an error the caller must handle).
  closeRoom(bookingId: string): Promise<void>;

  // Verifies the provider's webhook signature over the RAW body, then
  // normalises the payload into our own event shape. Returns null for
  // event types we don't record. Throws on signature failure (the route
  // maps that to a 400) — verification and normalisation are folded
  // together because for LiveKit they share the same key/secret and it
  // keeps the webhook route thin.
  verifyAndNormaliseEvent(
    rawBody: string,
    authHeader: string | null,
  ): Promise<NormalisedAttendanceEvent | null>;
}

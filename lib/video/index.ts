import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { VIDEO_CONFIG, maxConcurrentConnectionUnits } from "./config";
import { liveKitProvider as provider } from "./livekit/provider";
import { resolveVideoAttendance } from "./attendance";
import type { NormalisedAttendanceEvent, VideoParticipantRole } from "./types";

// THE seam. Every other module in the app calls exactly these functions
// and never imports the LiveKit SDK, knows what a LiveKit room is, or
// knows the provider exists. Mirrors lib/payments/index.ts's role for
// Stripe. Booking-flow wiring (calling ensureVideoSession from the two
// booking paths), the token route, the webhook route, and the cron wiring
// are LATER slices — this slice just makes the seam real and typed.

export { VIDEO_CONFIG, maxConcurrentConnectionUnits, liveKitPlan } from "./config";
export { projectVideoUsage, type VideoUsageProjection } from "./usage";

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

// The session window for a booking: [start - EARLY_JOIN, end + GRACE],
// computed from config (the single home for the offsets). Shared by
// session creation and the capacity check so both reason about the exact
// same padded window.
function sessionWindow(startUtc: string, endUtc: string): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(new Date(startUtc).getTime() - VIDEO_CONFIG.EARLY_JOIN_MINUTES * 60_000),
    closesAt: new Date(new Date(endUtc).getTime() + VIDEO_CONFIG.POST_SESSION_GRACE_MINUTES * 60_000),
  };
}

// Creates the video_sessions row for a booking, if it's online. Fetches
// the booking's own times/type under service role, so callers pass only
// the id — the paid path (Stripe webhook) never has end_utc to hand in,
// and neither path should have to know the window math. Idempotent (the
// RPC is a no-op on conflict), so it's safe from both booking paths and
// the reconcile backfill.
export async function ensureVideoSession(bookingId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("start_utc, end_utc, delivery_type")
    .eq("id", bookingId)
    .single();
  if (fetchError || !booking) {
    console.error("ensureVideoSession: booking fetch failed", { bookingId, error: fetchError });
    return;
  }
  if (booking.delivery_type !== "online") return;

  const { opensAt, closesAt } = sessionWindow(booking.start_utc as string, booking.end_utc as string);
  const { error } = await supabase.rpc("ensure_video_session_for_booking", {
    p_booking_id: bookingId,
    p_opens_at: opensAt.toISOString(),
    p_closes_at: closesAt.toISOString(),
  });
  if (error) {
    console.error("ensureVideoSession: RPC failed", { bookingId, error });
  }
}

// Booking-time capacity gate for an online session at [startUtc, endUtc].
// True if scheduling one more 1:1 session (its connection units) over the
// padded window stays within the plan cap. Soft cap by design — checked
// here, not enforced by a DB constraint (see the RPC's own comment).
export async function videoCapacityAvailable(startUtc: string, endUtc: string): Promise<boolean> {
  const { opensAt, closesAt } = sessionWindow(startUtc, endUtc);
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("count_overlapping_video_connection_units", {
    window_start: opensAt.toISOString(),
    window_end: closesAt.toISOString(),
  });
  if (error) {
    // Fail OPEN: a capacity-check outage shouldn't block bookings. The
    // provider's own account ceiling is the ultimate backstop, and an
    // occasional over-provision is the accepted soft-cap trade.
    console.error("videoCapacityAvailable: count RPC failed, allowing", { error });
    return true;
  }
  const inUse = (data as number | null) ?? 0;
  return inUse + VIDEO_CONFIG.CONNECTION_UNITS_PER_1TO1_SESSION <= maxConcurrentConnectionUnits();
}

// ---------------------------------------------------------------------------
// Token issue (join)
// ---------------------------------------------------------------------------

export type IssueTokenResult =
  | { ok: true; token: string; url: string; expiresAt: string }
  | { ok: false; reason: "forbidden" | "too_early" | "too_late" };

type VideoAccessRow = {
  provider_room_name: string;
  opens_at: string;
  closes_at: string;
  status: string;
  caller_role: VideoParticipantRole;
};

export type VideoRoomAccess = {
  // too_early/open/ended are computed from now vs the window; unavailable
  // means the RPC returned nothing (not a party, not online, not confirmed).
  state: "too_early" | "open" | "ended" | "unavailable";
  opensAt: string | null;
  closesAt: string | null;
  callerRole: VideoParticipantRole | null;
  roomName: string | null;
};

// Server-side read for the session page's first paint — same access RPC
// as the token flow, but returns the window + a computed state (no token
// minted; that happens on the Join tap). Lets the page render the right
// screen (countdown / device-check / ended) without a client round-trip
// or any polling: the client gets opensAt/closesAt and counts down itself.
export async function getVideoRoomAccess(bookingId: string): Promise<VideoRoomAccess> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_my_booking_video_access", { target_booking_id: bookingId })
    .single();
  if (error || !data) {
    return { state: "unavailable", opensAt: null, closesAt: null, callerRole: null, roomName: null };
  }
  const row = data as VideoAccessRow;
  const now = Date.now();
  const state =
    now < new Date(row.opens_at).getTime()
      ? "too_early"
      : now > new Date(row.closes_at).getTime()
        ? "ended"
        : "open";
  return {
    state,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    callerRole: row.caller_role,
    roomName: row.provider_room_name,
  };
}

// Called from the token route (next slice) under the caller's own session.
// Authorization is entirely the get_my_booking_video_access RPC: a user
// can only get a token for an online, confirmed booking they're a party
// to. The window floor (no token before opens_at) is enforced here rather
// than in the token, since LiveKit has no not-before claim.
export async function issueVideoJoinToken(bookingId: string): Promise<IssueTokenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "forbidden" };

  const { data, error } = await supabase
    .rpc("get_my_booking_video_access", { target_booking_id: bookingId })
    .single();
  if (error || !data) return { ok: false, reason: "forbidden" };
  const access = data as VideoAccessRow;

  const now = Date.now();
  const closesAt = new Date(access.closes_at);
  if (now < new Date(access.opens_at).getTime()) return { ok: false, reason: "too_early" };
  if (now > closesAt.getTime()) return { ok: false, reason: "too_late" };

  // Display name from the caller's own profile (granted column); falls
  // back to a neutral label rather than leaking anything if absent.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  await ensureProviderRoom(bookingId);

  const credential = await provider.issueJoinCredential({
    bookingId,
    participantId: user.id,
    participantRole: access.caller_role,
    displayName: (profile?.display_name as string | null) ?? "",
    expiresAt: closesAt,
  });

  return {
    ok: true,
    token: credential.token,
    url: credential.url,
    expiresAt: credential.expiresAt.toISOString(),
  };
}

// Lazy provider-room creation on first valid join. Server-side only; the
// stamp of room_created_at is what makes this happen exactly once.
async function ensureProviderRoom(bookingId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("video_sessions")
    .select("room_created_at")
    .eq("booking_id", bookingId)
    .single();
  if (existing?.room_created_at) return;

  const handle = await provider.createRoom({
    bookingId,
    maxParticipants: VIDEO_CONFIG.MAX_PARTICIPANTS_PER_SESSION,
    emptyTimeoutSeconds: VIDEO_CONFIG.EMPTY_ROOM_TIMEOUT_SECONDS,
  });

  await supabase
    .from("video_sessions")
    .update({
      room_created_at: new Date().toISOString(),
      provider_room_sid: handle.providerRoomSid,
      status: "open",
    })
    .eq("booking_id", bookingId)
    .is("room_created_at", null); // don't clobber if a concurrent join won the race
}

// ---------------------------------------------------------------------------
// Webhook ingestion
// ---------------------------------------------------------------------------

// Verifies the webhook signature and normalises the payload. Throws on a
// bad signature so the route can return 400 BEFORE the response is sent —
// same split as the Stripe route (verify sync, process in after()).
// Returns null for an event type we don't record.
export async function verifyAndNormaliseVideoEvent(
  rawBody: string,
  authHeader: string | null,
): Promise<NormalisedAttendanceEvent | null> {
  return provider.verifyAndNormaliseEvent(rawBody, authHeader);
}

// Persists an already-verified, normalised event to our own tables.
// Participant role is resolved HERE from the booking's parties, never
// trusted from the payload. Idempotent on provider_event_id (webhook
// redelivery is a clean no-op). Meant to run inside the route's after().
export async function persistVideoEvent(normalised: NormalisedAttendanceEvent): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: session } = await supabase
    .from("video_sessions")
    .select("id")
    .eq("booking_id", normalised.bookingId)
    .single();
  if (!session) {
    console.error("recordVideoWebhookEvent: no video_session for booking", { bookingId: normalised.bookingId });
    return;
  }

  let participantRole: VideoParticipantRole | null = null;
  if (normalised.participantId) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("client_id, practitioner_id")
      .eq("id", normalised.bookingId)
      .single();
    if (booking) {
      participantRole =
        normalised.participantId === booking.client_id
          ? "client"
          : normalised.participantId === booking.practitioner_id
            ? "practitioner"
            : null;
    }
  }

  const { error } = await supabase.from("video_attendance_events").insert({
    booking_id: normalised.bookingId,
    video_session_id: session.id,
    event_type: normalised.eventType,
    participant_id: normalised.participantId,
    participant_role: participantRole,
    occurred_at: normalised.occurredAt.toISOString(),
    provider_event_id: normalised.providerEventId,
  });
  // 23505 = unique_violation on provider_event_id: a redelivered event we
  // already recorded. That IS the idempotency guarantee, not a failure.
  if (error && error.code !== "23505") {
    console.error("recordVideoWebhookEvent: insert failed", { bookingId: normalised.bookingId, error });
  }

  // Reflect room lifecycle onto the session's own status.
  if (normalised.eventType === "room_opened") {
    await supabase
      .from("video_sessions")
      .update({ status: "open", room_created_at: normalised.occurredAt.toISOString() })
      .eq("id", session.id)
      .is("room_created_at", null);
  } else if (normalised.eventType === "room_closed") {
    // The room emptied. Only FINALISE the session when its time is actually
    // up (now >= closes_at, which with no grace = end_utc). A room that
    // empties mid-session (both stepped away) is not the end: leave it
    // 'open' so a reconnect re-creates the room under the same booking, and
    // don't resolve yet. When it closes at/after the end, mark it closed and
    // resolve from ALL accumulated attendance events across every room
    // instance for this booking.
    const { data: s } = await supabase.from("video_sessions").select("closes_at").eq("id", session.id).single();
    if (s && new Date(s.closes_at).getTime() <= normalised.occurredAt.getTime()) {
      await supabase.from("video_sessions").update({ status: "closed" }).eq("id", session.id);
      await resolveVideoAttendance(session.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Emergency-contact fallback
// ---------------------------------------------------------------------------

export type RevealResult = { ok: true; contact: string } | { ok: false; reason: "unavailable" };

// Called from the fallback route (next slice) under the caller's session.
// All the eligibility (client-only, in-window, not-revoked, contact-set)
// and the logging + fallback_used flip happen inside the RPC. Rate-limit
// is applied at the route, per your security spec.
export async function revealEmergencyContact(bookingId: string): Promise<RevealResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("reveal_booking_emergency_contact", { target_booking_id: bookingId })
    .single();
  if (error || !data) return { ok: false, reason: "unavailable" };
  const contact = (data as { emergency_contact: string | null }).emergency_contact;
  if (!contact) return { ok: false, reason: "unavailable" };
  return { ok: true, contact };
}

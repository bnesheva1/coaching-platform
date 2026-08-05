import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { VIDEO_CONFIG } from "./config";
import { liveKitProvider as provider } from "./livekit/provider";
import type { VideoParticipantRole } from "./types";

// THE seam. Every other module in the app calls exactly these functions
// and never imports the LiveKit SDK, knows what a LiveKit room is, or
// knows the provider exists. Mirrors lib/payments/index.ts's role for
// Stripe. Booking-flow wiring (calling ensureVideoSession from the two
// booking paths), the token route, the webhook route, and the cron wiring
// are LATER slices — this slice just makes the seam real and typed.

export { VIDEO_CONFIG, maxConcurrentConnectionUnits, liveKitPlan } from "./config";

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

// Computes the session window from config (the single home for the
// offsets) and creates the video_sessions row via the service-role-only
// RPC. Idempotent — safe to call from both booking paths and from the
// reconcile backfill. NEXT SLICE: call this from bookSlot's software_
// provider insert and from the Stripe webhook after confirm_paid_booking.
export async function ensureVideoSession(
  bookingId: string,
  startUtc: string,
  endUtc: string,
): Promise<void> {
  const opensAt = new Date(new Date(startUtc).getTime() - VIDEO_CONFIG.EARLY_JOIN_MINUTES * 60_000);
  const closesAt = new Date(new Date(endUtc).getTime() + VIDEO_CONFIG.POST_SESSION_GRACE_MINUTES * 60_000);

  const supabase = createServiceRoleClient();
  const { error } = await supabase.rpc("ensure_video_session_for_booking", {
    p_booking_id: bookingId,
    p_opens_at: opensAt.toISOString(),
    p_closes_at: closesAt.toISOString(),
  });
  if (error) {
    console.error("ensureVideoSession: RPC failed", { bookingId, error });
  }
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

// Called from the LiveKit webhook route (next slice). Verifies + normalises
// via the provider (throws on bad signature — the route maps that to 400),
// then persists to our own tables. Participant role is resolved HERE from
// the booking's parties, not trusted from the payload. Idempotent on
// provider_event_id (webhook redelivery is a clean no-op).
export async function recordVideoWebhookEvent(rawBody: string, authHeader: string | null): Promise<void> {
  const normalised = await provider.verifyAndNormaliseEvent(rawBody, authHeader);
  if (!normalised) return; // an event type we don't record

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
    await supabase.from("video_sessions").update({ status: "closed" }).eq("id", session.id);
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

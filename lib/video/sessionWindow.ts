import { VIDEO_CONFIG } from "./config";

// The single source of truth for the join/room window, derived from the
// video config so the UI can never drift from the actual room. Client-safe
// (no server-only imports) — used by both server pages and the client
// BookingsList so the join button and the "in progress" state follow the
// same offsets the LiveKit room itself uses (opens_at = start - EARLY_JOIN,
// closes_at = end + POST_SESSION_GRACE; see lib/video/index.ts).
export const EARLY_JOIN_MS = VIDEO_CONFIG.EARLY_JOIN_MINUTES * 60_000;
export const POST_SESSION_GRACE_MS = VIDEO_CONFIG.POST_SESSION_GRACE_MINUTES * 60_000;

export type SessionTimeState = "upcoming" | "in_progress" | "past";

// A booking's time state relative to the room window. "in_progress" spans
// the whole live session up to the room's close (end + grace), so a session
// running slightly over is still shown as live and joinable, not "past".
export function sessionTimeState(startUtc: string, endUtc: string, nowMs: number): SessionTimeState {
  const start = new Date(startUtc).getTime();
  const closes = new Date(endUtc).getTime() + POST_SESSION_GRACE_MS;
  if (nowMs > closes) return "past";
  if (nowMs >= start) return "in_progress";
  return "upcoming";
}

// The end_utc cutoff for a "not past" booking query: a booking's room is
// still open (upcoming or in progress) when its end_utc >= this value.
// Plain helper so the Date.now() isn't flagged by react-hooks/purity.
export function notPastEndCutoffIso(): string {
  return new Date(Date.now() - POST_SESSION_GRACE_MS).toISOString();
}

// Convenience for server components: is this session live right now? A
// plain (non-component) helper so the Date.now() call isn't flagged by
// react-hooks/purity — same reason splitUpcomingPast is a plain function.
export function isSessionLive(startUtc: string, endUtc: string): boolean {
  return sessionTimeState(startUtc, endUtc, Date.now()) === "in_progress";
}

// Whether the room is joinable right now: the exact window the token route
// enforces — [start - EARLY_JOIN, end + POST_SESSION_GRACE]. Both the
// initial join and every reconnect use this same window.
export function withinJoinWindow(startUtc: string, endUtc: string, nowMs: number): boolean {
  return (
    nowMs >= new Date(startUtc).getTime() - EARLY_JOIN_MS &&
    nowMs <= new Date(endUtc).getTime() + POST_SESSION_GRACE_MS
  );
}

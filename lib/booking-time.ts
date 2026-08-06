import { POST_SESSION_GRACE_MS } from "@/lib/video/sessionWindow";

// Pulled out of the dashboard page components because the
// react-hooks/purity lint rule flags Date.now() called directly inside
// a component function body (component functions must be pure/render-
// idempotent). A plain, non-component helper isn't subject to that
// rule, and the split is timezone-independent — it only ever compares
// UTC instants, so it's safe to do before either dashboard applies its
// own timezone formatting.
//
// The boundary is the ROOM's close (end + grace), NOT start: a session
// that has begun but isn't over yet is still live — it stays in
// `upcoming` (so its join/rejoin button and "in progress" state show),
// and only moves to `past` once the room has actually closed. Matches
// lib/video/sessionWindow.ts's sessionTimeState.
export function splitUpcomingPast<T extends { startUtc: string; endUtc: string }>(
  bookings: T[],
): { upcoming: T[]; past: T[] } {
  const now = Date.now();
  const isPast = (b: T) => new Date(b.endUtc).getTime() + POST_SESSION_GRACE_MS < now;
  const upcoming = bookings
    .filter((b) => !isPast(b))
    .sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime());
  const past = bookings
    .filter(isPast)
    .sort((a, b) => new Date(b.startUtc).getTime() - new Date(a.startUtc).getTime());
  return { upcoming, past };
}

// UX-only check (mirrors cancel-booking-actions.ts's identical
// comparison, which is the actual enforcement, backed further by the
// client-cancel RLS policy's own USING clause) — used to hide the
// cancel button once a booking is within its practitioner's notice
// window, since self-cancellation isn't offered there at all (the
// client would contact the practitioner instead). Same reasoning as
// splitUpcomingPast for why this needs to be a plain function rather
// than inline in a component body.
export function isPastCancellationCutoff(startUtc: string, minNoticeHours: number): boolean {
  const cutoff = Date.now() + minNoticeHours * 60 * 60 * 1000;
  return new Date(startUtc).getTime() < cutoff;
}

// Lives here rather than in BookingsList.tsx (which re-exports both,
// unchanged, for its existing "use client" importers) because a plain
// const exported from a "use client" module still gets replaced with a
// client reference at the server/client boundary — a Server Component
// importing it directly fails at runtime ("X.has is not a function"),
// even though it's just a Set with no browser dependency. This file has
// no directive, so both server pages and client components can import
// it safely.
export const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);
export const CANCELLED_STATUSES = new Set(["cancelled_by_client", "cancelled_by_practitioner"]);

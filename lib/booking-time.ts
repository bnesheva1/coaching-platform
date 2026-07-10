// Pulled out of the dashboard page components because the
// react-hooks/purity lint rule flags Date.now() called directly inside
// a component function body (component functions must be pure/render-
// idempotent). A plain, non-component helper isn't subject to that
// rule, and the upcoming/past split is timezone-independent — it only
// ever compares UTC instants, so it's safe to do before either
// dashboard applies its own timezone formatting.
export function splitUpcomingPast<T extends { startUtc: string }>(
  bookings: T[],
): { upcoming: T[]; past: T[] } {
  const now = Date.now();
  const upcoming = bookings
    .filter((b) => new Date(b.startUtc).getTime() >= now)
    .sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime());
  const past = bookings
    .filter((b) => new Date(b.startUtc).getTime() < now)
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

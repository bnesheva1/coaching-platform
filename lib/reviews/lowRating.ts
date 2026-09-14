// The app-specific decision behind the proactive low-rating alert: is a review's
// rating in the lowest band that should ping admins? Ratings are 1–5. Threshold
// defaults to 1 (only 1★) and is env-overridable (e.g. widen to <= 2 later).
// Pure + dependency-free so it can be unit-tested directly (see
// scripts/verify-low-rating.ts); the alert PLUMBING lives in createReview via
// the proven raiseAlert + push gate.
export const LOW_RATING_THRESHOLD = Number(process.env.LOW_RATING_THRESHOLD ?? "1") || 1;

export function isLowRating(rating: number, threshold: number = LOW_RATING_THRESHOLD): boolean {
  return Number.isFinite(rating) && rating <= threshold;
}

export type LowRatingReview = { rating: number; bookingId: string; practitionerId: string; hasText: boolean };

// The alert-raising WIRING, with raiseAlert injected so it stays dependency-free
// and unit-testable (createReview passes the real raiseAlert). Raises exactly
// once, with booking/practitioner/rating, only when the rating is in the low
// band; returns whether it raised. `raise` is typed to the exact low_rating
// payload — the real raiseAlert is assignable to it.
type RaiseLowRating = (input: {
  type: "low_rating";
  severity: "critical";
  immediate: true;
  subject: string;
  message: string;
  context: Record<string, unknown>;
}) => Promise<void>;

export async function notifyLowRating(review: LowRatingReview, raise: RaiseLowRating, threshold: number = LOW_RATING_THRESHOLD): Promise<boolean> {
  if (!isLowRating(review.rating, threshold)) return false;
  await raise({
    type: "low_rating",
    severity: "critical",
    immediate: true,
    subject: review.bookingId,
    message: `Low rating (${review.rating}★) left on a completed session.`,
    context: { bookingId: review.bookingId, practitionerId: review.practitionerId, rating: review.rating, hasText: review.hasText },
  });
  return true;
}

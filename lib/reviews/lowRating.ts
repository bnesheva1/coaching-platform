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

// Shared handling for users who no longer exist / have been anonymised, so
// historical records (bookings, sessions, reviews, receipts, admin views) show
// a localized placeholder instead of a blank or the raw English marker.
//
// Two deletion shapes exist in this app (see app/account-actions.ts):
//   • SOFT delete / anonymise (the normal app path): the profiles row is KEPT
//     and profiles.display_name is set to the fixed marker below. Joins still
//     resolve, so the name comes back as this exact string.
//   • HARD delete (test-account cleanup, or a manual Supabase deletion): the row
//     is gone, so a join returns null and loaders fall back to "" (blank).
//
// The stored marker is intentionally a fixed, locale-neutral string (it can't
// know who will read it later); localisation happens HERE, at render time, in
// the viewer's own locale — which is why the label lives in the i18n messages
// (DeletedUser.label) and this module only detects, never translates.

// Must match exactly what app/account-actions.ts writes on anonymisation.
export const DELETED_USER_SENTINEL = "Deleted user";

/**
 * True when the name is the anonymise marker OR missing/blank. Use in
 * HISTORICAL contexts (bookings, sessions, video, emails) where the referenced
 * party is a fixed past record — a blank name there means the row is gone.
 */
export function isMissingOrDeleted(name?: string | null): boolean {
  const n = (name ?? "").trim();
  return n === "" || n === DELETED_USER_SENTINEL;
}

/**
 * True only for the anonymise marker. Use in LIVE-ENTITY contexts (browse/saved
 * cards, public profile, admin practitioner list) where a blank display_name is
 * a legitimate onboarding-incomplete state that should fall back to @username,
 * NOT be shown as a deleted user.
 */
export function isAnonymised(name?: string | null): boolean {
  return (name ?? "").trim() === DELETED_USER_SENTINEL;
}

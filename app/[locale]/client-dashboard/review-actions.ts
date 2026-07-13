"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, reviewLimiter } from "@/lib/rate-limit";

// Matches the existing bio-length convention (no DB-level length CHECK
// on free text anywhere in this schema — app-level bound only).
const MAX_REVIEW_TEXT_LENGTH = 1000;

export type ReviewFormState = { error?: string; success?: boolean } | null;

// bookingId is bound via .bind(null, bookingId) from the per-row form,
// not an editable field — but binding isn't a security boundary, a
// direct call could send any bookingId. Every check here is re-derived
// server-side, and the reviews INSERT RLS policy (client_id = auth.uid()
// and status = 'completed') is the authoritative, independent backstop —
// this app-level check only exists to produce a specific, translated
// message before that policy would otherwise just silently reject the
// insert.
export async function createReview(
  bookingId: string,
  _prevState: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const t = await getTranslations("Reviews");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const { success } = await checkRateLimit(reviewLimiter, user.id);
  if (!success) {
    return { error: t("rateLimited") };
  }

  const ratingRaw = formData.get("rating");
  const rating = typeof ratingRaw === "string" ? Number.parseInt(ratingRaw, 10) : NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: t("ratingRequired") };
  }

  const reviewTextRaw = formData.get("reviewText");
  const reviewText = typeof reviewTextRaw === "string" ? reviewTextRaw.trim() : "";
  if (reviewText.length > MAX_REVIEW_TEXT_LENGTH) {
    return { error: t("reviewTextTooLong") };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("client_id, practitioner_id, status")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.client_id !== user.id) {
    return { error: t("bookingNotFound") };
  }
  if (booking.status !== "completed") {
    return { error: t("notCompletedYet") };
  }

  // A snapshot of the reviewer's name at the time of writing, captured
  // for internal use only (e.g. resolving an abuse report) — it's never
  // added to the reviews SELECT grant (see the migration), so this is
  // write-only from the app's perspective: nothing downstream of this
  // insert ever reads it back.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Explicit column list, not a bare .select() — booking_id is excluded
  // from the grant entirely, and a bare .select() implicitly requests
  // every grant-visible column via RETURNING, which would fail here.
  const { error } = await supabase
    .from("reviews")
    .insert({
      booking_id: bookingId,
      practitioner_id: booking.practitioner_id,
      rating,
      review_text: reviewText || null,
      reviewer_display_name: profile?.display_name ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: t("alreadyReviewed") };
    }
    console.error("createReview failed:", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/client-dashboard");
  return { success: true };
}

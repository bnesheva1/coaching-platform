"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendReviewReplyEmail } from "@/lib/email";

export type ReviewReplyState = { error?: string; success?: boolean } | null;

const MAX_REPLY = 2000;

// Post or edit the practitioner's single public reply to a review. An empty
// submission clears the reply. RLS (practitioner_id = auth.uid()) + the
// column-level grant mean this can only ever touch reply_text on the caller's
// own reviews. Notifies the client (best-effort) when a reply is posted.
export async function saveReviewReply(reviewId: string, _prev: ReviewReplyState, formData: FormData): Promise<ReviewReplyState> {
  const t = await getTranslations("ReviewReply");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const raw = (formData.get("replyText") as string | null)?.trim() ?? "";
  if (raw.length > MAX_REPLY) return { error: t("tooLong", { max: MAX_REPLY }) };
  const replyText = raw.length > 0 ? raw : null;

  // RLS scopes this to the caller's own reviews; .select() returns [] if the
  // review isn't theirs (or doesn't exist), which we treat as an error.
  const { data, error } = await supabase.from("reviews").update({ reply_text: replyText }).eq("id", reviewId).select("id");
  if (error) {
    console.error("saveReviewReply failed", { reviewId, error });
    return { error: t("genericError") };
  }
  if (!data || data.length === 0) return { error: t("genericError") };

  // Notify the client only when a reply was posted (not when cleared).
  if (replyText) {
    try {
      await sendReviewReplyEmail(reviewId);
    } catch (err) {
      console.error("saveReviewReply: reply notification failed (reply saved)", { reviewId, err });
    }
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

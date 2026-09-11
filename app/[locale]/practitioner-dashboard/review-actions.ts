"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { raiseAlert } from "@/lib/alerts";

export type SubmitForReviewState = { error?: string } | null;

// Practitioner-initiated "Submit for review" (first submission) and "Submit
// again" (after changes_requested). The RPC is owner-scoped and only moves a
// pre-approval profile into the queue (→ pending + a fresh submitted stamp);
// it can never self-approve. A submission pings Telegram immediately so review
// doesn't depend on an admin opening the queue.
export async function submitForReview(_prev: SubmitForReviewState): Promise<SubmitForReviewState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "NOT_AUTHENTICATED" };

  const { error } = await supabase.rpc("submit_practitioner_for_review");
  if (error) {
    console.error("submitForReview: RPC failed", { userId: user.id, error });
    return { error: "SUBMIT_FAILED" };
  }

  // Own display name for the alert text (owner can read their own profile row).
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const name = (profile?.display_name as string | null)?.trim() || user.email || user.id;

  // Best-effort — a Telegram/alert hiccup must not fail the submission. The
  // changing submittedAt keeps the fingerprint fresh so a resubmit re-pings
  // rather than being deduped as "the same pending profile".
  try {
    await raiseAlert({
      type: "practitioner_review_pending",
      severity: "critical",
      immediate: true,
      subject: user.id,
      message: `Нов профил за преглед: ${name}`,
      context: { practitionerId: user.id, submittedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error("submitForReview: alert failed (submission still recorded)", { userId: user.id, err });
  }

  // The moderation banner lives in the dashboard layout — refresh it so the
  // state flips from "draft/changes requested" to "in review" immediately.
  revalidatePath("/[locale]/practitioner-dashboard", "layout");
  return null;
}

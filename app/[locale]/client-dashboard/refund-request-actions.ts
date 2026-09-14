"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RefundRequestState = { error?: string; success?: boolean } | null;

// A client submits a refund request for one of their OWN past bookings. One per
// booking (DB unique on booking_id). Goes to the admin queue as 'pending' — no
// auto-approval. RLS enforces ownership; this re-checks for a clean message.
export async function submitRefundRequest(bookingId: string, _prev: RefundRequestState, formData: FormData): Promise<RefundRequestState> {
  const t = await getTranslations("RefundRequest");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const reasonType = String(formData.get("reasonType") ?? "");
  if (!["technical_failure", "other"].includes(reasonType)) return { error: t("reasonRequired") };
  const reasonText = (formData.get("reasonText") as string | null)?.trim() ?? "";
  if (reasonType === "other" && !reasonText) return { error: t("descriptionRequired") };

  // Ownership + post-session: must be the caller's booking and already ended.
  const { data: booking } = await supabase.from("bookings").select("client_id, end_utc").eq("id", bookingId).maybeSingle();
  if (!booking || booking.client_id !== user.id) return { error: t("genericError") };
  if (new Date(booking.end_utc as string).getTime() > Date.now()) return { error: t("notYetEnded") };

  const { error } = await supabase.from("refund_requests").insert({
    booking_id: bookingId,
    client_id: user.id,
    reason_type: reasonType,
    // Free text only carries for 'other'; technical_failure is a named category.
    reason_text: reasonType === "other" ? reasonText : null,
  });
  if (error) {
    if (error.code === "23505") return { error: t("alreadyRequested") }; // unique(booking_id)
    console.error("submitRefundRequest failed", { bookingId, error });
    return { error: t("genericError") };
  }

  revalidatePath("/client-dashboard");
  return { success: true };
}

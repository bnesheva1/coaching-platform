"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { refundBookingPayment } from "@/lib/payments";

export type RefundReviewState = { error?: string } | null;

// Approve → trigger the real refund (branches on whether the payout already
// released, via refundBookingPayment) and mark the request approved. Only marks
// approved if the refund actually went through, so a "not applicable" (no
// payment through us) or a Stripe error surfaces to the admin instead of a
// false "approved".
export async function approveRefundRequest(requestId: string, _prev: RefundReviewState): Promise<RefundReviewState> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: req } = await supabase.from("refund_requests").select("id, booking_id, status").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "pending") return { error: "NOT_PENDING" };

  const result = await refundBookingPayment(req.booking_id as string);
  if (!result.refunded) {
    return { error: result.reason === "not_applicable" ? "NO_PAYMENT" : "REFUND_FAILED" };
  }

  await supabase
    .from("refund_requests")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "refund_request:approved",
    targetId: req.booking_id as string,
    previousValue: "pending",
    newValue: "approved + refunded",
  });
  revalidatePath("/[locale]/admin/refunds", "page");
  return null;
}

// Deny → record a client-visible reason; no refund happens.
export async function denyRefundRequest(requestId: string, _prev: RefundReviewState, formData: FormData): Promise<RefundReviewState> {
  const user = await requireAdmin();
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const supabase = createServiceRoleClient();
  const { data: req } = await supabase.from("refund_requests").select("id, booking_id, status").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "pending") return { error: "NOT_PENDING" };

  await supabase
    .from("refund_requests")
    .update({ status: "denied", denial_reason: reason, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "refund_request:denied",
    targetId: req.booking_id as string,
    previousValue: "pending",
    newValue: `denied — ${reason}`,
  });
  revalidatePath("/[locale]/admin/refunds", "page");
  return null;
}

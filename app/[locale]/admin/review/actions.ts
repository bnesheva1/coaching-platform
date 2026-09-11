"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendProfileApprovedEmail, sendProfileChangesRequestedEmail } from "@/lib/email";

export type ReviewActionState = { error?: string } | null;

// Approve a pending profile → `active` (the existing live state). Clears the
// submitted stamp and any prior reason, records the action, and emails the
// practitioner that they're live. Mirrors setModeration's shape.
export async function approveProfile(practitionerId: string, _prev: ReviewActionState): Promise<ReviewActionState> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("moderation_status")
    .eq("id", practitionerId)
    .single();
  // Only a profile actually awaiting review can be approved from here — guards
  // against a stale queue (someone else already actioned it).
  if (!current || !["pending", "changes_requested"].includes(current.moderation_status as string)) {
    return { error: "NOT_PENDING" };
  }

  await supabase
    .from("practitioner_profiles")
    .update({
      moderation_status: "active",
      moderation_reason: null,
      review_submitted_at: null,
      moderation_applied_by: user.id,
      moderation_applied_at: new Date().toISOString(),
    })
    .eq("id", practitionerId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "practitioner.review:approved",
    targetId: practitionerId,
    previousValue: current.moderation_status as string,
    newValue: "active",
  });

  // Best-effort notice — a mail hiccup must not fail the approval (the profile
  // is already live). Logged inside the sender.
  await sendProfileApprovedEmail(practitionerId);

  revalidatePath("/[locale]/admin/review", "page");
  return null;
}

// Reject → `changes_requested` with a required reason (shown to the practitioner
// in their banner + the email). They edit and resubmit (→ pending) from their
// own dashboard.
export async function rejectProfile(
  practitionerId: string,
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const user = await requireAdmin();
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const supabase = createServiceRoleClient();
  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("moderation_status")
    .eq("id", practitionerId)
    .single();
  if (!current || !["pending", "changes_requested"].includes(current.moderation_status as string)) {
    return { error: "NOT_PENDING" };
  }

  await supabase
    .from("practitioner_profiles")
    .update({
      moderation_status: "changes_requested",
      moderation_reason: reason,
      review_submitted_at: null,
      moderation_applied_by: user.id,
      moderation_applied_at: new Date().toISOString(),
    })
    .eq("id", practitionerId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "practitioner.review:changes_requested",
    targetId: practitionerId,
    previousValue: current.moderation_status as string,
    newValue: `changes_requested — ${reason}`,
  });

  await sendProfileChangesRequestedEmail(practitionerId, reason);

  revalidatePath("/[locale]/admin/review", "page");
  return null;
}

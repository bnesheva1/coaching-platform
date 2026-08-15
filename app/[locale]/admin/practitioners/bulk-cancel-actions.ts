"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { executeBulkCancel, type BulkCancelResult } from "@/lib/admin/bulkCancel";

export type BulkCancelActionState = { error: string } | { result: BulkCancelResult } | null;

// Executes the bulk cancel-and-refund. requireAdmin (highest-privilege, real
// money), reason required + shown to clients, and the typed username must match
// (the account-deletion friction pattern) — server-side, not just UI. The
// operation itself is idempotent + re-runnable (see executeBulkCancel), so a
// timed-out run is finished by submitting again. Audits who/when/practitioner/
// counts/total/reason + the full per-booking outcomes (in detail jsonb).
export async function runBulkCancel(
  practitionerId: string,
  username: string,
  _prev: BulkCancelActionState,
  formData: FormData,
): Promise<BulkCancelActionState> {
  const user = await requireAdmin();

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };
  const typed = (formData.get("confirmUsername") as string | null)?.trim() ?? "";
  if (typed !== username) return { error: "USERNAME_MISMATCH" };

  const result = await executeBulkCancel(practitionerId, reason, user.id);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "practitioner.bulk_cancel",
    previousValue: `@${username} · ${result.outcomes.length} processed`,
    newValue: `refunded ${result.counts.refunded} · refund-failed ${result.counts.refundFailed} · no-payment ${result.counts.noPayment} · already-refunded ${result.counts.alreadyRefunded} — reason: ${reason}`,
    detail: {
      batchId: result.batchId,
      complete: result.complete,
      totalRefundedCents: result.totalRefundedCents,
      currency: result.currency,
      counts: result.counts,
      outcomes: result.outcomes,
    },
  });

  revalidatePath("/[locale]/admin/practitioners", "page");
  return { result };
}

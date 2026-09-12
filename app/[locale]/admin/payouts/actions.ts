"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { releaseBookingPayout } from "@/lib/payments/stripe/transfer";

export type PayoutActionState = { error?: string } | null;

// Release a held/pending payout immediately, ahead of its scheduled time. Uses
// the same release path as the sweep, so all its guards apply (frozen → refused,
// already-released → no-op). Coexists with the freeze switch: a frozen
// practitioner's payout can't be force-released here either.
export async function releasePayoutNow(bookingId: string, _prev: PayoutActionState): Promise<PayoutActionState> {
  const user = await requireAdmin();
  const res = await releaseBookingPayout(bookingId);
  if (!res.released) {
    return { error: res.reason === "payouts_frozen" ? "FROZEN" : res.reason === "transfer_error" ? "TRANSFER_FAILED" : "NOT_RELEASABLE" };
  }
  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "practitioner.payout:released_early",
    targetId: bookingId,
    previousValue: "pending",
    newValue: "released",
  });
  revalidatePath("/[locale]/admin/payouts", "page");
  return null;
}

// Push a payout's scheduled release time out by N days (keeps it pending so it
// still auto-releases later). On top of the freeze switch — this is per-booking.
export async function extendPayoutHold(bookingId: string, _prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const user = await requireAdmin();
  const days = Number(formData.get("days") ?? "0");
  if (!Number.isFinite(days) || days <= 0) return { error: "INVALID_DAYS" };

  const supabase = createServiceRoleClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, release_at, transfer_status")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!payment || !["pending", "held"].includes(payment.transfer_status as string)) return { error: "NOT_RELEASABLE" };

  // Extend from the later of now / the current release time.
  const base = Math.max(Date.now(), payment.release_at ? new Date(payment.release_at as string).getTime() : 0);
  const newRelease = new Date(base + days * 86_400_000).toISOString();
  await supabase
    .from("payments")
    .update({ release_at: newRelease, transfer_status: "pending", updated_at: new Date().toISOString() })
    .eq("id", payment.id);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: "practitioner.payout:hold_extended",
    targetId: bookingId,
    previousValue: (payment.release_at as string | null) ?? "unset",
    newValue: `${newRelease} (+${days}d)`,
  });
  revalidatePath("/[locale]/admin/payouts", "page");
  return null;
}

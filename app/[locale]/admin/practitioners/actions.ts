"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getConnectedAccountId, setPayoutsHold } from "@/lib/payments";

// { error } surfaces a validation/Stripe failure back into the dialog;
// null = success (the dialog closes and the page revalidates). Error values are
// stable codes the client maps to translated copy.
export type PractitionerControlState = { error: string } | null;

const MODERATION_STATUSES = ["active", "hidden", "bookings_frozen", "suspended"] as const;

// Apply (or reverse) a moderation control. The reason is REQUIRED and shown to
// the practitioner (a control nobody can explain later is worse than none), and
// every transition — including a reversal back to active — is written to the
// audit log with who/when/prev→new/reason. Bound to practitionerId by the
// caller; status + reason arrive in the form. Enforcement lives in the bookable
// derivation and search, not here — this only records intent.
export async function setModeration(
  practitionerId: string,
  _prev: PractitionerControlState,
  formData: FormData,
): Promise<PractitionerControlState> {
  const user = await requireAdmin();

  const status = String(formData.get("status") ?? "");
  if (!(MODERATION_STATUSES as readonly string[]).includes(status)) {
    return { error: "INVALID" };
  }
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const supabase = createServiceRoleClient();
  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("moderation_status")
    .eq("id", practitionerId)
    .single();
  const previous = current?.moderation_status ?? "active";
  if (previous === status) return null; // already there — nothing to record

  const isActive = status === "active";
  await supabase
    .from("practitioner_profiles")
    .update({
      moderation_status: status,
      // Clearing the control clears the shown reason; the WHY of the reversal
      // still lives in the audit log below.
      moderation_reason: isActive ? null : reason,
      moderation_applied_by: user.id,
      moderation_applied_at: new Date().toISOString(),
    })
    .eq("id", practitionerId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `practitioner.moderation:${status}`,
    previousValue: previous,
    newValue: `${status} — ${reason}`,
  });

  revalidatePath("/[locale]/admin/practitioners", "page");
  return null;
}

// Freeze or release payouts. Flips the connected account's Stripe payout
// schedule (see lib/payments setPayoutsHold) BEFORE the DB write, so a Stripe
// failure leaves the recorded state consistent with reality rather than marking
// someone frozen whose money is still flowing. A practitioner with no connected
// account (software_provider / not onboarded) has no payouts to hold — the flag
// is still recorded, but there's no Stripe call to make.
export async function setPayoutsFreeze(
  practitionerId: string,
  _prev: PractitionerControlState,
  formData: FormData,
): Promise<PractitionerControlState> {
  const user = await requireAdmin();

  const frozen = String(formData.get("frozen") ?? "") === "true";
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const supabase = createServiceRoleClient();
  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("payouts_frozen")
    .eq("id", practitionerId)
    .single();
  const previous = current?.payouts_frozen ?? false;
  if (previous === frozen) return null;

  const accountId = await getConnectedAccountId(practitionerId);
  if (accountId) {
    try {
      await setPayoutsHold(accountId, frozen);
    } catch (e) {
      console.error("setPayoutsFreeze: Stripe payout schedule update failed", { practitionerId, error: e });
      return { error: "STRIPE_FAILED" };
    }
  }

  await supabase
    .from("practitioner_profiles")
    .update({
      payouts_frozen: frozen,
      payouts_reason: frozen ? reason : null,
      payouts_frozen_by: user.id,
      payouts_frozen_at: new Date().toISOString(),
    })
    .eq("id", practitionerId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `practitioner.payouts:${frozen ? "frozen" : "released"}`,
    previousValue: String(previous),
    newValue: `${frozen ? "frozen" : "released"} — ${reason}`,
  });

  revalidatePath("/[locale]/admin/practitioners", "page");
  return null;
}

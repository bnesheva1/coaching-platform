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

// Percent (what the admin types) → a clean string like "15" or "7.5",
// stripping float artifacts, for the audit log's human-readable values.
function pctLabel(rate: number | null): string {
  return rate == null ? "default" : `${+(rate * 100).toFixed(4)}%`;
}

// Set or clear a practitioner's commission-rate override. The admin enters a
// PERCENT (0–100, decimals ok); an empty field clears the override back to the
// brand default. The rate follows the practitioner (early-recruit terms), and
// a required reason is recorded on the row (who/when/why) plus in the audit
// log — an unexplained 0% six months on is a mystery. The resolved rate is
// snapshotted onto each payment at booking time, so this only affects FUTURE
// bookings, never what was already charged. Mirrors setModeration.
export async function setCommissionOverride(
  practitionerId: string,
  _prev: PractitionerControlState,
  formData: FormData,
): Promise<PractitionerControlState> {
  const user = await requireAdmin();

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const rawRate = (formData.get("rate") as string | null)?.trim() ?? "";
  let override: number | null;
  if (rawRate === "") {
    override = null; // clear → brand default
  } else {
    const pct = Number(rawRate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "INVALID_RATE" };
    override = pct / 100; // store the fraction; DB CHECK re-enforces 0–1
  }

  const supabase = createServiceRoleClient();
  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("commission_rate_override")
    .eq("id", practitionerId)
    .single();
  const previous = (current?.commission_rate_override as number | null) ?? null;
  if (previous === override) return null; // unchanged — nothing to record

  await supabase
    .from("practitioner_profiles")
    .update({
      commission_rate_override: override,
      // Clearing drops the shown reason; the WHY of the clear still lives in
      // the audit log below.
      commission_rate_reason: override == null ? null : reason,
      commission_rate_set_by: user.id,
      commission_rate_set_at: new Date().toISOString(),
    })
    .eq("id", practitionerId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `practitioner.commission:${override == null ? "clear" : "set"}`,
    previousValue: pctLabel(previous),
    newValue: `${pctLabel(override)} — ${reason}`,
    detail: { override, reason },
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

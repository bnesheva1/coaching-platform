"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getConnectedAccountId, setPayoutsHold } from "@/lib/payments";
import { cancelPractitionerSubscription } from "@/lib/payments/stripe/subscription";

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

// A price in cents → a clean euro string ("15", "12.5") for the audit log.
function eurLabel(cents: number | null): string {
  return cents == null ? "default" : `€${+(cents / 100).toFixed(2)}`;
}

// Set or clear a practitioner's subscription override — a SEPARATE axis from
// commission (same person, two independent controls). The admin can mark them
// EXEMPT (subscribed-and-active, charged nothing — founders/shareholders/
// negotiated terms) and/or set a CUSTOM monthly fee in euros; an empty price +
// unchecked exempt clears back to the brand default. A required reason is
// recorded on the row (who/when/why) and in the audit log.
//
// Exempt is a lifecycle transition, not just a flag: turning it ON moves the
// status to 'exempt' and cancels any live Stripe subscription (an exempt
// practitioner should not keep being billed); turning it OFF returns the status
// to 'not_required' (the cancelled subscription is gone — they'd re-subscribe).
// A pure price change (exempt unchanged) never touches the status, so a live
// paying subscription keeps running and the new price applies to future
// checkouts only. Mirrors setCommissionOverride.
export async function setSubscriptionOverride(
  practitionerId: string,
  _prev: PractitionerControlState,
  formData: FormData,
): Promise<PractitionerControlState> {
  const user = await requireAdmin();

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) return { error: "REASON_REQUIRED" };

  const exempt = String(formData.get("exempt") ?? "") === "true";

  // The admin types EUROS (empty = brand default); stored as cents. Ignored for
  // charging when exempt, but still stored so un-exempting restores it.
  const rawPrice = (formData.get("price") as string | null)?.trim() ?? "";
  let priceCents: number | null;
  if (rawPrice === "") {
    priceCents = null;
  } else {
    const euros = Number(rawPrice);
    if (!Number.isFinite(euros) || euros < 0 || euros > 10000) return { error: "INVALID_PRICE" };
    priceCents = Math.round(euros * 100);
  }

  const supabase = createServiceRoleClient();
  const { data: current } = await supabase
    .from("practitioner_profiles")
    .select("subscription_exempt, subscription_price_override_cents, subscription_status, stripe_subscription_id")
    .eq("id", practitionerId)
    .single();
  const prevExempt = current?.subscription_exempt ?? false;
  const prevPrice = (current?.subscription_price_override_cents as number | null) ?? null;
  if (prevExempt === exempt && prevPrice === priceCents) return null; // unchanged

  const hasOverride = exempt || priceCents != null;
  const update: Record<string, unknown> = {
    subscription_exempt: exempt,
    subscription_price_override_cents: priceCents,
    subscription_override_reason: hasOverride ? reason : null,
    subscription_override_set_by: user.id,
    subscription_override_set_at: new Date().toISOString(),
  };

  // Status transitions driven purely by the exempt flag flipping.
  if (exempt && !prevExempt) {
    update.subscription_status = "exempt";
  } else if (!exempt && prevExempt) {
    update.subscription_status = "not_required";
  }

  await supabase.from("practitioner_profiles").update(update).eq("id", practitionerId);

  // Turning exempt ON: stop billing them. Best-effort — a Stripe failure here
  // must not leave the DB unwritten (the row already reflects exempt, which is
  // the source of truth for bookability); logged for manual follow-up. On a
  // SUCCESSFUL cancel we also clear the stored subscription id: the Stripe
  // subscription is gone, so un-exempting them later must lead to a genuine
  // fresh subscribe, not a Billing-Portal "revive" of a dead subscription (see
  // startSubscription's has_subscription branch). Only cleared on success, so a
  // failed cancel keeps the id for a retry / manual follow-up rather than
  // orphaning a still-billing subscription we can no longer see.
  if (exempt && !prevExempt && current?.stripe_subscription_id) {
    try {
      await cancelPractitionerSubscription(current.stripe_subscription_id as string);
      await supabase
        .from("practitioner_profiles")
        .update({ stripe_subscription_id: null, subscription_current_period_end: null })
        .eq("id", practitionerId);
    } catch (e) {
      console.error("setSubscriptionOverride: Stripe subscription cancel failed", { practitionerId, error: e });
    }
  }

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `practitioner.subscription:${hasOverride ? "set" : "clear"}`,
    previousValue: `${prevExempt ? "exempt" : eurLabel(prevPrice)}`,
    newValue: `${exempt ? "exempt" : eurLabel(priceCents)} — ${reason}`,
    detail: { exempt, priceCents, reason },
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

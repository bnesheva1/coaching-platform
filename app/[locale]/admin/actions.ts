"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled, invalidateFlags, ADMIN_TOGGLEABLE, type AdminToggleableKey } from "@/lib/flags";

// Dismiss an alert. requireAdmin first (the highest-privilege surface); the
// dismissal is written to the audit log, so there's always a record of who
// silenced what and when. _formData is the bound-server-action shape (see
// bookSlot etc.) — the id is bound, the form supplies the rest.
export async function dismissAlert(alertId: string, _formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: alert } = await supabase
    .from("alerts")
    .select("type, subject, status")
    .eq("id", alertId)
    .single();
  if (!alert || alert.status === "dismissed") return;

  await supabase
    .from("alerts")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismissed_by: user.id })
    .eq("id", alertId);

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `alert.dismiss:${alert.type}`,
    previousValue: `active (${alert.subject})`,
    newValue: "dismissed",
  });

  revalidatePath("/[locale]/admin", "page");
}

// Toggle a runtime kill switch. Bound-action shape: flag + target state are
// bound from the button, _formData is the form payload. requireAdmin first, the
// flag is allow-listed against ADMIN_TOGGLEABLE (so a forged request can't flip
// a deploy-scope or unknown key), and the change is written to the audit log
// with the previous/new resolved values before invalidating the flags cache so
// the admin sees it take effect immediately (read-your-own-writes).
export async function setFlag(flag: string, enabled: boolean, _formData: FormData): Promise<void> {
  const user = await requireAdmin();

  if (!(ADMIN_TOGGLEABLE as readonly string[]).includes(flag)) {
    // Not an admin-toggleable flag — ignore silently rather than write a
    // bogus override for an unknown/deploy-scope key.
    return;
  }
  const key = flag as AdminToggleableKey;

  // Previous resolved value, for the audit trail. Read before the write.
  const previous = await isEnabled(key);
  if (previous === enabled) {
    // No-op toggle (double click, stale form) — nothing to record or change.
    return;
  }

  const supabase = createServiceRoleClient();
  await supabase
    .from("feature_flags")
    .upsert({ key, enabled, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });

  await recordAdminAction({
    actorId: user.id,
    actorEmail: user.email,
    action: `flag.set:${key}`,
    previousValue: String(previous),
    newValue: String(enabled),
  });

  invalidateFlags();
  revalidatePath("/[locale]/admin", "page");
}

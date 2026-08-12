"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

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

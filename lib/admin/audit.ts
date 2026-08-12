import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// One row in admin_audit_log per admin action: who, when, what changed, and
// the previous/new values. Call this AFTER requireAdmin, so the actor is a
// verified admin. Best-effort: a logging failure is logged, never thrown — an
// audit write must not fail the action it records (but it should essentially
// never fail, since the table is tiny and service-role). actor_email is
// snapshotted so the log stays readable if that account is later anonymised.
export async function recordAdminAction(entry: {
  actorId: string;
  actorEmail: string | null;
  action: string;
  previousValue?: string | null;
  newValue?: string | null;
}): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from("admin_audit_log")
    .insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      action: entry.action,
      previous_value: entry.previousValue ?? null,
      new_value: entry.newValue ?? null,
    });
  if (error) {
    console.error("recordAdminAction failed", { action: entry.action, error });
  }
}

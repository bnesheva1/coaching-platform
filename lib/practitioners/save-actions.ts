"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, saveLimiter } from "@/lib/rate-limit";

export type SaveResult =
  | { ok: true; saved: boolean }
  | { ok: false; reason: "not_logged_in" | "not_client" | "rate_limited" | "error" };

// Toggle a practitioner in the caller's private saved list: insert to save, delete
// to unsave. Returns the resulting state so the client can render it optimistically
// and reconcile. Only clients have a saved list; RLS additionally guarantees a
// caller can only ever touch their own rows.
export async function toggleSavePractitioner(practitionerId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_logged_in" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "client") return { ok: false, reason: "not_client" };

  const { success } = await checkRateLimit(saveLimiter, user.id);
  if (!success) return { ok: false, reason: "rate_limited" };

  const { data: existing } = await supabase
    .from("saved_practitioners")
    .select("id")
    .eq("client_id", user.id)
    .eq("practitioner_id", practitionerId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("saved_practitioners").delete().eq("id", existing.id as string);
    if (error) {
      console.error("toggleSavePractitioner: delete failed", { practitionerId, error });
      return { ok: false, reason: "error" };
    }
    return { ok: true, saved: false };
  }

  const { error } = await supabase.from("saved_practitioners").insert({ client_id: user.id, practitioner_id: practitionerId });
  if (error) {
    // A unique-violation from a double-click race just means it's already saved.
    if (error.code === "23505") return { ok: true, saved: true };
    console.error("toggleSavePractitioner: insert failed", { practitionerId, error });
    return { ok: false, reason: "error" };
  }
  return { ok: true, saved: true };
}

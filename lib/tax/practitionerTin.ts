import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { TinType } from "./tin";

// practitioner_profiles.tin / tin_type are excluded from every client SELECT
// grant (a national identifier). This reads a practitioner's OWN TIN server-side
// via the service role — to pre-fill the settings field and to gate the backfill
// banner. Admin/reporting code reads it the same way. Callers pass the current
// user's id; nothing here widens who may read it.
export async function getMyTin(userId: string): Promise<{ tin: string; tinType: TinType } | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("practitioner_profiles").select("tin, tin_type").eq("id", userId).single();
  if (error) {
    console.error("getMyTin: read failed", { userId, error });
    return null;
  }
  if (!data?.tin || !data?.tin_type) return null;
  return { tin: data.tin as string, tinType: data.tin_type as TinType };
}

// Cheap boolean for the "please add your TIN" backfill banner.
export async function hasTin(userId: string): Promise<boolean> {
  return (await getMyTin(userId)) !== null;
}

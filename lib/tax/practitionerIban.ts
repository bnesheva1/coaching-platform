import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// practitioner_profiles.iban is excluded from every client SELECT grant (a bank
// identifier). Reads a practitioner's OWN IBAN server-side via the service role —
// to pre-fill the settings field, gate the backfill banner, and feed the DAC7
// report. Same treatment as getMyTin.
export async function getMyIban(userId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("practitioner_profiles").select("iban").eq("id", userId).single();
  if (error) {
    console.error("getMyIban: read failed", { userId, error });
    return null;
  }
  return (data?.iban as string | null) ?? null;
}

export async function hasIban(userId: string): Promise<boolean> {
  return (await getMyIban(userId)) !== null;
}

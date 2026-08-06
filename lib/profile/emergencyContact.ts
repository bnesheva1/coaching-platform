import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// practitioner_profiles.emergency_contact is excluded from client SELECT
// grants (readable only via reveal_booking_emergency_contact). This reads a
// practitioner's OWN contact server-side, to pre-fill the settings field.
// Scoped to the passed id by the caller (always the current user).
export async function getEmergencyContact(userId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("practitioner_profiles")
    .select("emergency_contact")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("getEmergencyContact: read failed", { userId, error });
    return null;
  }
  return (data?.emergency_contact as string | null) ?? null;
}

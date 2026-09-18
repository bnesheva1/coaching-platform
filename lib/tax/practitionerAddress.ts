import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { PractitionerAddress } from "./address";

// practitioner_profiles.address_* are excluded from every client SELECT grant.
// Reads a practitioner's OWN address server-side via the service role — settings
// pre-fill, backfill-banner gate, and the DAC7 report. Same treatment as TIN/IBAN.
// Returns null unless the full address is present (all-or-nothing at rest).
export async function getMyAddress(userId: string): Promise<PractitionerAddress | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("practitioner_profiles")
    .select("address_street, address_building, address_postcode, address_city, address_country")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("getMyAddress: read failed", { userId, error });
    return null;
  }
  if (!data?.address_street || !data?.address_building || !data?.address_postcode || !data?.address_city || !data?.address_country) return null;
  return {
    street: data.address_street as string,
    building: data.address_building as string,
    postcode: data.address_postcode as string,
    city: data.address_city as string,
    country: data.address_country as string,
  };
}

export async function hasAddress(userId: string): Promise<boolean> {
  return (await getMyAddress(userId)) !== null;
}

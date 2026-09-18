"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateAddress } from "@/lib/tax/address";

export type AddressState = { error?: string; success?: boolean } | null;

// The practitioner sets their OWN mailing address (all fields required — an
// address is all-or-nothing). Validated + normalised here before write; stored
// across the address_* columns. No .select() (columns aren't in any SELECT
// grant) — same as tin/iban/emergency_contact.
export async function saveAddress(_prev: AddressState, formData: FormData): Promise<AddressState> {
  const t = await getTranslations("TaxId");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const result = validateAddress({
    street: (formData.get("street") as string | null) ?? "",
    building: (formData.get("building") as string | null) ?? "",
    postcode: (formData.get("postcode") as string | null) ?? "",
    city: (formData.get("city") as string | null) ?? "",
    country: (formData.get("country") as string | null) ?? "",
  });
  if (!result.ok) return { error: t(`addr_${result.field}Invalid`) };

  const { value } = result;
  const { error } = await supabase
    .from("practitioner_profiles")
    .update({
      address_street: value.street,
      address_building: value.building,
      address_postcode: value.postcode,
      address_city: value.city,
      address_country: value.country,
    })
    .eq("id", user.id);
  if (error) {
    console.error("saveAddress failed:", error);
    return { error: t("saveFailed") };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

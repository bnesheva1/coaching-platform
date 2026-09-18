"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { parseIban } from "@/lib/tax/iban";

export type IbanState = { error?: string; success?: boolean } | null;

// The practitioner sets their OWN IBAN. Full MOD-97 validation here before write;
// the stored value is the normalised (spaceless, uppercase) form. iban is in the
// update grant (own row via the update RLS policy); no .select() (not in any
// SELECT grant) — same as tin/emergency_contact.
export async function saveIban(_prev: IbanState, formData: FormData): Promise<IbanState> {
  const t = await getTranslations("TaxId");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const raw = ((formData.get("iban") as string | null) ?? "").trim();
  if (!raw) return { error: t("ibanRequired") };
  const value = parseIban(raw);
  if (!value) return { error: t("invalidIban") };

  const { error } = await supabase.from("practitioner_profiles").update({ iban: value }).eq("id", user.id);
  if (error) {
    console.error("saveIban failed:", error);
    return { error: t("saveFailed") };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

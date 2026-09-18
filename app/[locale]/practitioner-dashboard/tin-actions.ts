"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateTin, type TinType } from "@/lib/tax/tin";

export type TinState = { error?: string; success?: boolean } | null;

// The practitioner sets their OWN TIN (ЕГН or VAT). Validated in full here
// (ЕГН checksum + date, VAT format) before write; the value stored is the
// normalised form. tin/tin_type are in the update grant (own row via the update
// RLS policy), so a plain update works — and, like emergency_contact, no
// .select() (the columns aren't in any SELECT grant).
export async function saveTin(_prev: TinState, formData: FormData): Promise<TinState> {
  const t = await getTranslations("TaxId");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("genericError") };

  const tinType = formData.get("tinType") as string | null;
  const raw = ((formData.get("tin") as string | null) ?? "").trim();
  if (tinType !== "egn" && tinType !== "vat") return { error: t("typeRequired") };
  if (!raw) return { error: t("required") };

  const value = validateTin(tinType as TinType, raw);
  if (!value) return { error: tinType === "egn" ? t("invalidEgn") : t("invalidVat") };

  const { error } = await supabase.from("practitioner_profiles").update({ tin: value, tin_type: tinType }).eq("id", user.id);
  if (error) {
    console.error("saveTin failed:", error);
    return { error: t("saveFailed") };
  }
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

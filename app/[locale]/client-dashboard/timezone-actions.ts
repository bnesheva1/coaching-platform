"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export type ClientTimezoneState = { error?: string; success?: boolean } | null;

// The DB only shape-checks the timezone column, so validating with the
// same Intl mechanism it's actually used with later is the real check —
// same reasoning as the practitioner-side updateTimezone.
function isValidTimezone(candidate: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

// A client sets their own display timezone on profiles.timezone (clients
// are RLS-granted update on their own display_name/timezone). This is the
// value the client dashboard and booking slots resolve to first, ahead of
// the browser guess — see components/dashboard/ClientTimezone.tsx.
export async function updateClientTimezone(
  _prevState: ClientTimezoneState,
  formData: FormData,
): Promise<ClientTimezoneState> {
  const t = await getTranslations("AccountSettings");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("timezoneNotLoggedIn") };
  }

  const timezone = (formData.get("timezone") as string)?.trim();
  if (!timezone || !isValidTimezone(timezone)) {
    return { error: t("timezoneInvalid") };
  }

  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", user.id);
  if (error) {
    console.error("updateClientTimezone failed:", error);
    return { error: t("timezoneSaveFailed") };
  }

  // "layout" — the dashboard reads profiles.timezone server-side to seed
  // the client-side resolver; refresh it so the saved value takes hold
  // without a hard reload.
  revalidatePath("/client-dashboard", "layout");
  return { success: true };
}

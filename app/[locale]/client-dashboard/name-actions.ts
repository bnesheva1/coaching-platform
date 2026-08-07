"use server";

import { revalidatePath } from "next/cache";
import { getTranslations, getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getRenameUsage, recordRename, formatRenameDate } from "@/lib/rename-limits";

const MAX_DISPLAY_NAME_LENGTH = 100;

export type NameFormState = { error?: string; success?: boolean } | null;

// Lets a client change the name their practitioners see. Rate-limited
// server-side (3 / 30 days) and logged to rename_events, same as the
// practitioner-side name/username changes.
export async function updateClientDisplayName(
  _prev: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("notLoggedIn") };

  const displayName = ((formData.get("displayName") as string) ?? "").trim();
  if (!displayName) return { error: t("displayNameRequired") };
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { error: t("displayNameTooLong", { max: MAX_DISPLAY_NAME_LENGTH }) };
  }

  // Unchanged resubmit — no limit consumed, no log entry.
  const { data: currentProfile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const current = currentProfile?.display_name ?? "";
  if (displayName === current) return { success: true };

  const usage = await getRenameUsage(user.id, "client_display_name");
  if (usage.remaining <= 0) {
    const locale = await getLocale();
    return {
      error: usage.nextAllowedAt
        ? t("renameLimitReached", { date: formatRenameDate(usage.nextAllowedAt, locale) })
        : t("saveFailed"),
    };
  }

  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
  if (error) {
    console.error("updateClientDisplayName failed:", error);
    return { error: t("saveFailed") };
  }

  await recordRename(user.id, "display_name", current || null, displayName);
  revalidatePath("/client-dashboard", "layout");
  return { success: true };
}

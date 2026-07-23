"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export type ScheduleSettingsFormState = { error?: string; success?: boolean } | null;

// Product-chosen range (see the matching DB CHECK on
// practitioner_profiles.min_notice_hours): a practitioner must require
// at least some notice, but not more than two days.
const MIN_MIN_NOTICE_HOURS = 1;
const MAX_MIN_NOTICE_HOURS = 48;

// Ported verbatim from the old saveProfile — the DB only shape-checks
// the timezone column, so this (using the same Intl-based mechanism the
// timezone is actually used with later) is the real correctness check.
function isValidTimezone(candidate: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

// Split from a single combined updateScheduleSettings action — timezone
// now lives as its own plain top-of-page element and minimum notice as
// its own card at the bottom (see the Schedule tab restructure), so
// they're submitted independently and must not touch each other's
// column. Same column-scoped-action precedent as actions.ts's
// updateProfileText/updateSpecialties/updateUsername split.
export async function updateTimezone(
  _prevState: ScheduleSettingsFormState,
  formData: FormData,
): Promise<ScheduleSettingsFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const timezone = (formData.get("timezone") as string)?.trim();
  if (!timezone || !isValidTimezone(timezone)) {
    return { error: t("timezoneInvalid") };
  }

  const { error } = await supabase.from("practitioner_profiles").update({ timezone }).eq("id", user.id);
  if (error) {
    console.error("updateTimezone failed:", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export async function updateMinNoticeHours(
  _prevState: ScheduleSettingsFormState,
  formData: FormData,
): Promise<ScheduleSettingsFormState> {
  const t = await getTranslations("Profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const minNoticeHours = Number(formData.get("minNoticeHours"));
  if (
    !Number.isInteger(minNoticeHours) ||
    minNoticeHours < MIN_MIN_NOTICE_HOURS ||
    minNoticeHours > MAX_MIN_NOTICE_HOURS
  ) {
    return {
      error: t("minNoticeHoursInvalid", { min: MIN_MIN_NOTICE_HOURS, max: MAX_MIN_NOTICE_HOURS }),
    };
  }

  const { error } = await supabase
    .from("practitioner_profiles")
    .update({ min_notice_hours: minNoticeHours })
    .eq("id", user.id);
  if (error) {
    console.error("updateMinNoticeHours failed:", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

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

// Split out of the old single-form saveProfile — timezone and notice
// window are booking mechanics, not profile identity, so they now live
// on the Schedule tab next to availability rules instead of the
// Profile tab. Touches only these two columns; safe alongside the
// Profile tab's own column-scoped actions (see actions.ts's shared
// comment on why splitting the old upsert this way is safe).
export async function updateScheduleSettings(
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
  const minNoticeHours = Number(formData.get("minNoticeHours"));

  if (!timezone || !isValidTimezone(timezone)) {
    return { error: t("timezoneInvalid") };
  }
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
    .update({ timezone, min_notice_hours: minNoticeHours })
    .eq("id", user.id);

  if (error) {
    console.error("updateScheduleSettings failed:", error);
    return { error: t("saveFailed") };
  }

  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

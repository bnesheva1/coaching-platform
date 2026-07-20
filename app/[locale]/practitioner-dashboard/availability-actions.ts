"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityFormState = { error?: string; success?: boolean } | null;

const MIN_DURATION_MINUTES = 15;

// Validated independently of the <input type="time"> element's own
// browser-side constraint — that only shapes what a real browser submits,
// not what a direct API/form-post call could send.
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(value: string): number | null {
  const match = TIME_FORMAT.exec(value);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export async function createAvailabilityRule(
  _prevState: AvailabilityFormState,
  formData: FormData,
): Promise<AvailabilityFormState> {
  const t = await getTranslations("Availability");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const dayOfWeek = parseInt(formData.get("dayOfWeek") as string, 10);
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return { error: t("invalidDay") };
  }

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) {
    return { error: t("invalidTime") };
  }
  // Both times must land on a 15-minute mark (:00/:15/:30/:45) — the
  // `step={900}` on the <input type="time">s nudges this in a real
  // browser, but that's UX only, not enforcement.
  if (startMinutes % MIN_DURATION_MINUTES !== 0 || endMinutes % MIN_DURATION_MINUTES !== 0) {
    return { error: t("invalidGrid", { min: MIN_DURATION_MINUTES }) };
  }
  // Checked separately from the duration-too-short case below: a
  // negative difference (end before start) is also "< 15 minutes"
  // arithmetically, but conflating the two produced a confusing message
  // for what's actually a different, more basic mistake.
  if (endMinutes <= startMinutes) {
    return { error: t("endBeforeStart") };
  }
  if (endMinutes - startMinutes < MIN_DURATION_MINUTES) {
    return { error: t("rangeTooShort", { min: MIN_DURATION_MINUTES }) };
  }

  const { error } = await supabase.from("practitioner_availability").insert({
    practitioner_id: user.id,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    console.error("createAvailabilityRule failed:", error);
    return { error: t("saveFailed") };
  }

  // "layout" — the dashboard is now a route group (layout.tsx + six
  // pages) rather than one page; this invalidates the shared layout and
  // every page beneath it (Начало's isBookable gate depends on this
  // same availability data), not just the literal "/practitioner-
  // dashboard" path a plain page-type revalidation would target.
  revalidatePath("/practitioner-dashboard", "layout");
  return { success: true };
}

export async function deleteAvailabilityRule(ruleId: string, _formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  const { error } = await supabase
    .from("practitioner_availability")
    .delete()
    .eq("id", ruleId)
    .eq("practitioner_id", user.id);

  if (error) {
    console.error("deleteAvailabilityRule failed:", error);
  }

  // "layout" — the dashboard is now a route group (layout.tsx + six
  // pages) rather than one page; this invalidates the shared layout and
  // every page beneath it (Начало's isBookable gate depends on this
  // same availability data), not just the literal "/practitioner-
  // dashboard" path a plain page-type revalidation would target.
  revalidatePath("/practitioner-dashboard", "layout");
}

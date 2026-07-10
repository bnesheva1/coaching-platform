"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityExceptionFormState =
  | { error?: string; success?: boolean; warningCount?: number }
  | null;

// Validated independently of the <input type="date"> element's own
// browser-side constraint, same reasoning as availability-actions.ts's
// TIME_FORMAT — that only shapes what a real browser submits, not what
// a direct API/form-post call could send.
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors availability-actions.ts's own TIME_FORMAT/timeToMinutes/grid
// checks verbatim — duplicated rather than shared, same precedent
// AvailabilitySection.tsx already established for this exact
// validation (a handful of lines, not worth a shared module for).
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MIN_DURATION_MINUTES = 15;

function timeToMinutes(value: string): number | null {
  const match = TIME_FORMAT.exec(value);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export async function createAvailabilityException(
  _prevState: AvailabilityExceptionFormState,
  formData: FormData,
): Promise<AvailabilityExceptionFormState> {
  const t = await getTranslations("AvailabilityExceptions");
  const tAvailability = await getTranslations("Availability");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("notLoggedIn") };
  }

  const exceptionDate = formData.get("exceptionDate") as string;
  if (!DATE_FORMAT.test(exceptionDate) || !DateTime.fromISO(exceptionDate).isValid) {
    return { error: t("invalidDate") };
  }

  const startTime = (formData.get("startTime") as string)?.trim() || null;
  const endTime = (formData.get("endTime") as string)?.trim() || null;

  if ((startTime === null) !== (endTime === null)) {
    return { error: t("invalidTimeRange") };
  }

  let startMinutes: number | null = null;
  let endMinutes: number | null = null;
  if (startTime !== null && endTime !== null) {
    startMinutes = timeToMinutes(startTime);
    endMinutes = timeToMinutes(endTime);
    if (startMinutes === null || endMinutes === null) {
      return { error: tAvailability("invalidTime") };
    }
    if (startMinutes % MIN_DURATION_MINUTES !== 0 || endMinutes % MIN_DURATION_MINUTES !== 0) {
      return { error: tAvailability("invalidGrid", { min: MIN_DURATION_MINUTES }) };
    }
    if (endMinutes <= startMinutes) {
      return { error: tAvailability("endBeforeStart") };
    }
  }

  const { data: profile } = await supabase
    .from("practitioner_profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const timezone = profile?.timezone ?? "Europe/Sofia";

  // "Past" is relative to the practitioner's own calendar, not the
  // server's or a client's — ISO dates sort lexically, so a plain
  // string comparison against "today" in their zone is exact.
  const todayLocal = DateTime.now().setZone(timezone).toISODate()!;
  if (exceptionDate < todayLocal) {
    return { error: t("dateInPast") };
  }

  const { error } = await supabase.from("availability_exceptions").insert({
    practitioner_id: user.id,
    exception_date: exceptionDate,
    exception_type: "blocked",
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: t("dateAlreadyBlocked") };
    }
    console.error("createAvailabilityException failed:", error);
    return { error: t("saveFailed") };
  }

  // Read-only — deliberately does not touch bookings. Blocking a
  // date/range only prevents NEW bookings on it (see generateSlots'
  // blockedDates/blockedRanges handling); an existing confirmed booking
  // is cancellation's own separate concern. This is purely a heads-up
  // for the practitioner so they aren't surprised. Narrowed to the
  // actual range when one was given, not the whole day, so a
  // 14:00-16:00 block doesn't warn about an unrelated 09:00 booking.
  const rangeStartUtc = (
    startTime !== null
      ? DateTime.fromISO(`${exceptionDate}T${startTime}`, { zone: timezone })
      : DateTime.fromISO(exceptionDate, { zone: timezone }).startOf("day")
  )
    .toUTC()
    .toISO();
  const rangeEndUtc = (
    endTime !== null
      ? DateTime.fromISO(`${exceptionDate}T${endTime}`, { zone: timezone })
      : DateTime.fromISO(exceptionDate, { zone: timezone }).endOf("day")
  )
    .toUTC()
    .toISO();
  const { count: warningCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", user.id)
    .in("status", ["pending", "confirmed"])
    .lt("start_utc", rangeEndUtc!)
    .gt("end_utc", rangeStartUtc!);

  revalidatePath("/practitioner-dashboard");
  return { success: true, warningCount: warningCount ?? 0 };
}

export async function deleteAvailabilityException(exceptionId: string, _formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", exceptionId)
    .eq("practitioner_id", user.id);

  if (error) {
    console.error("deleteAvailabilityException failed:", error);
  }

  revalidatePath("/practitioner-dashboard");
}

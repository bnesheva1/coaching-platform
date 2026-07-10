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

export async function createAvailabilityException(
  _prevState: AvailabilityExceptionFormState,
  formData: FormData,
): Promise<AvailabilityExceptionFormState> {
  const t = await getTranslations("AvailabilityExceptions");
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
  });

  if (error) {
    if (error.code === "23505") {
      return { error: t("dateAlreadyBlocked") };
    }
    console.error("createAvailabilityException failed:", error);
    return { error: t("saveFailed") };
  }

  // Read-only — deliberately does not touch bookings. Blocking a date
  // only prevents NEW bookings on it (see generateSlots' blockedDates
  // handling); an existing confirmed booking is a separate, later
  // cancellation feature's concern. This is purely a heads-up for the
  // practitioner so they aren't surprised.
  const dayStartUtc = DateTime.fromISO(exceptionDate, { zone: timezone }).startOf("day").toUTC().toISO();
  const dayEndUtc = DateTime.fromISO(exceptionDate, { zone: timezone }).endOf("day").toUTC().toISO();
  const { count: warningCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", user.id)
    .neq("status", "cancelled")
    .lt("start_utc", dayEndUtc!)
    .gt("end_utc", dayStartUtc!);

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

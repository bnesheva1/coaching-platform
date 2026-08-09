import { createClient } from "@/lib/supabase/server";
import {
  generateSlots,
  BOOKING_WINDOW_DAYS,
  type BlockedRange,
  type ExistingBooking,
  type Slot,
} from "./generateSlots";

export type { Slot } from "./generateSlots";

// The server-only wrapper a page calls — it doesn't build the query
// itself, mirroring lib/practitioners/search.ts's convention. Service
// duration is always read from the matching DB row (scoped to this
// practitioner's own active services), never trusted from caller input —
// an invalid/foreign/inactive service ID just matches no row.
export async function getBookableSlots({
  practitionerId,
  serviceId,
}: {
  practitionerId: string;
  serviceId: string;
}): Promise<Slot[]> {
  const supabase = await createClient();

  // Platform-wide FLOOR on booking lead time (hours), from
  // MIN_BOOKING_NOTICE_HOURS. A practitioner may require MORE notice than
  // this but never less — the effective notice is max(floor, their own).
  // Unset/blank -> no floor, so each practitioner's own setting stands.
  //
  // Note: this is a SCHEDULED-booking concept only. Genuine "book now" /
  // "who's online" sessions are a separate feature on their own path and do
  // not flow through here. An earlier per-practitioner 0-notice bypass lived
  // here for QA, but it made the profile offer sub-floor slots that expired
  // between page render and click (re-validation in booking-actions.ts
  // recomputes against a fresh `now`), so they showed as bookable but
  // weren't. Removed — immediate sessions belong to the separate feature.
  const rawFloor = process.env.MIN_BOOKING_NOTICE_HOURS;
  const minNoticeFloorHours = rawFloor && rawFloor.trim() !== "" && Number.isFinite(Number(rawFloor)) ? Number(rawFloor) : 0;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + (BOOKING_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

  const [
    { data: profile, error: profileError },
    { data: rules, error: rulesError },
    { data: service, error: serviceError },
    { data: busyTimes, error: busyTimesError },
    { data: exceptions, error: exceptionsError },
  ] = await Promise.all([
    supabase
      .from("practitioner_profiles")
      .select("timezone, min_notice_hours")
      .eq("id", practitionerId)
      .single(),
    supabase
      .from("practitioner_availability")
      .select("day_of_week, start_time, end_time")
      .eq("practitioner_id", practitionerId),
    supabase
      .from("services")
      .select("duration_minutes")
      .eq("id", serviceId)
      .eq("practitioner_id", practitionerId)
      .eq("is_active", true)
      .single(),
    // get_practitioner_busy_times is a SECURITY DEFINER RPC, not a
    // direct table read — the bookings table's own SELECT policy only
    // allows the client/practitioner involved in each booking to read
    // it, but a public visitor still needs to know which time ranges
    // are taken (without seeing WHO booked them) to exclude them here.
    supabase.rpc("get_practitioner_busy_times", {
      target_practitioner_id: practitionerId,
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
    }),
    // No date-range filter — the table stays small at this scale, and
    // generateSlots does the exact-date-string match itself, so an
    // unbounded fetch here can't produce a wrong result, only a
    // slightly larger (harmless) one.
    supabase
      .from("availability_exceptions")
      .select("exception_date, start_time, end_time")
      .eq("practitioner_id", practitionerId)
      .eq("exception_type", "blocked"),
  ]);

  if (profileError || !profile) {
    console.error("getBookableSlots: failed to load practitioner timezone:", profileError);
    return [];
  }
  if (rulesError) {
    console.error("getBookableSlots: failed to load availability rules:", rulesError);
    return [];
  }
  if (serviceError || !service) {
    // Not an error worth logging — this is the expected shape of "no
    // such active service for this practitioner" (foreign/invalid ID).
    return [];
  }
  if (busyTimesError) {
    console.error("getBookableSlots: failed to load existing bookings:", busyTimesError);
    return [];
  }
  if (exceptionsError) {
    console.error("getBookableSlots: failed to load availability exceptions:", exceptionsError);
    return [];
  }

  const existingBookings: ExistingBooking[] = (
    (busyTimes ?? []) as { start_utc: string; end_utc: string }[]
  ).map((b) => ({
    startUtc: b.start_utc,
    endUtc: b.end_utc,
  }));

  // One query, split by whether a time range is set — start_time is
  // null exactly for whole-date blocks (unchanged meaning).
  const blockedDates: string[] = (exceptions ?? [])
    .filter((e) => e.start_time === null)
    .map((e) => e.exception_date);
  const blockedRanges: BlockedRange[] = (exceptions ?? [])
    .filter((e) => e.start_time !== null)
    .map((e) => ({ date: e.exception_date, startTime: e.start_time!, endTime: e.end_time! }));

  return generateSlots({
    rules: rules ?? [],
    timezone: profile.timezone,
    serviceDurationMinutes: service.duration_minutes,
    existingBookings,
    blockedDates,
    blockedRanges,
    minNoticeHours: Math.max(minNoticeFloorHours, profile.min_notice_hours),
  });
}

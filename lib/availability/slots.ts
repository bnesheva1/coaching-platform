import { createClient } from "@/lib/supabase/server";
import { generateSlots, type ExistingBooking, type Slot } from "./generateSlots";

export type { Slot } from "./generateSlots";

// Matches generateSlots' own default — kept in sync explicitly here
// rather than imported, since it also sizes the busy-times query window
// below (padded by a day to safely cover timezone-offset edge effects
// at the boundary, harmless to over-fetch).
const WINDOW_DAYS = 14;

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

  const now = new Date();
  const windowEnd = new Date(now.getTime() + (WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

  const [
    { data: profile, error: profileError },
    { data: rules, error: rulesError },
    { data: service, error: serviceError },
    { data: busyTimes, error: busyTimesError },
  ] = await Promise.all([
    supabase.from("practitioner_profiles").select("timezone").eq("id", practitionerId).single(),
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

  const existingBookings: ExistingBooking[] = (
    (busyTimes ?? []) as { start_utc: string; end_utc: string }[]
  ).map((b) => ({
    startUtc: b.start_utc,
    endUtc: b.end_utc,
  }));

  return generateSlots({
    rules: rules ?? [],
    timezone: profile.timezone,
    serviceDurationMinutes: service.duration_minutes,
    existingBookings,
  });
}

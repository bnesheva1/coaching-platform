import { createClient } from "@/lib/supabase/server";
import { generateSlots, type ExistingBooking, type Slot } from "./generateSlots";

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

  const [{ data: profile, error: profileError }, { data: rules, error: rulesError }, { data: service, error: serviceError }] =
    await Promise.all([
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

  // No bookings table exists yet (Epic 5 slice 2) — the exclusion logic
  // in generateSlots is already fully implemented and ready; this is the
  // only line that needs to change once real bookings can be fetched.
  const existingBookings: ExistingBooking[] = [];

  return generateSlots({
    rules: rules ?? [],
    timezone: profile.timezone,
    serviceDurationMinutes: service.duration_minutes,
    existingBookings,
  });
}

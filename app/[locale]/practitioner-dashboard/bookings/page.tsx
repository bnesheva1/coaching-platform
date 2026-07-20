import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { BookingsList, type PractitionerBooking } from "../BookingsList";
import { splitUpcomingPast } from "@/lib/booking-time";

// Auth/role guard already ran in the shared layout.tsx. Full history
// (upcoming, past, cancelled) — the new 6th nav item ("Резервации") that
// didn't exist in the approved design, added because the sidebar's 5
// tabs otherwise had no home for this existing feature. Overlaps
// somewhat with Начало's slimmer "upcoming this week" summary, by design
// (see the implementation plan).
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tBooking = await getTranslations("Booking");
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [{ data: practitionerProfile }, { data: bookings }] = await Promise.all([
    supabase.from("practitioner_profiles").select("timezone").eq("id", userId).single(),
    supabase
      .from("bookings")
      .select("id, client_id, service_id, start_utc, end_utc, status")
      .eq("practitioner_id", userId)
      .order("start_utc", { ascending: true }),
  ]);

  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id))];
  const bookingServiceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: clients }, { data: bookingServices }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    bookingServiceIds.length > 0
      ? supabase.from("services").select("id, name, duration_minutes").in("id", bookingServiceIds)
      : Promise.resolve({ data: [] as { id: string; name: string; duration_minutes: number }[] }),
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.display_name ?? ""]));
  const bookingServiceById = new Map((bookingServices ?? []).map((s) => [s.id, s]));

  const mergedBookings: PractitionerBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    clientName: clientNameById.get(b.client_id) ?? "",
    serviceName: bookingServiceById.get(b.service_id)?.name ?? "",
    durationMinutes: bookingServiceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as PractitionerBooking["status"],
  }));

  const { upcoming: upcomingBookings, past: pastBookings } = splitUpcomingPast(mergedBookings);

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode = typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      {/* No ContentContainer — DashboardShell already bounds/pads the
          sidebar+content row; see profile/page.tsx's identical note. */}
      <div style={{ maxWidth: 500 }}>
        {justCancelled && <p style={{ color: "green" }}>{tBooking("cancelledMessage")}</p>}
        {cancelErrorCode && (
          <p style={{ color: "crimson" }}>
            {tBooking.has(cancelErrorCode) ? tBooking(cancelErrorCode as Parameters<typeof tBooking>[0]) : tBooking("cancellationFailed")}
          </p>
        )}
        <BookingsList
          upcoming={upcomingBookings}
          past={pastBookings}
          timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
        />
      </div>
    </main>
  );
}

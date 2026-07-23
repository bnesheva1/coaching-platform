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

  // delivery_info is excluded from the general column grant entirely —
  // even the owning practitioner can't read it via a plain select (see
  // ServicesSection's identical note). This RPC is scoped to all of the
  // caller's own services (not just active/booked ones), unlike the
  // client-side get_my_active_booking_delivery_info, which is scoped to
  // the client's own active bookings instead.
  const [{ data: clients }, { data: bookingServices }, { data: deliveryInfoRows }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    bookingServiceIds.length > 0
      ? supabase.from("services").select("id, name, duration_minutes, delivery_type").in("id", bookingServiceIds)
      : Promise.resolve({ data: [] as { id: string; name: string; duration_minutes: number; delivery_type: string | null }[] }),
    supabase.rpc("get_my_services_delivery_info") as unknown as Promise<{
      data: { service_id: string; delivery_info: string | null }[] | null;
    }>,
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.display_name ?? ""]));
  const bookingServiceById = new Map((bookingServices ?? []).map((s) => [s.id, s]));
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));

  const mergedBookings: PractitionerBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    clientName: clientNameById.get(b.client_id) ?? "",
    serviceName: bookingServiceById.get(b.service_id)?.name ?? "",
    durationMinutes: bookingServiceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    // Real DB domain is 5 values (see bookings_status_check); no cast
    // needed now that PractitionerBooking's own union matches it.
    status: b.status as PractitionerBooking["status"],
    deliveryType: (bookingServiceById.get(b.service_id)?.delivery_type as "online" | "in_person" | null) ?? null,
    deliveryInfo: deliveryInfoByServiceId.get(b.service_id) ?? null,
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

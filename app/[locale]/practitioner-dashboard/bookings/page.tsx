import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { BookingsList, type SessionBooking } from "@/components/bookings/BookingsList";
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
      .select("id, client_id, service_id, start_utc, end_utc, status, service_name, delivery_type, price_cents, currency, created_at")
      .eq("practitioner_id", userId)
      .order("start_utc", { ascending: true }),
  ]);

  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id))];

  // No services join at all anymore — name/duration/delivery_type are
  // booking-time snapshots now, read straight off `bookings` above (see
  // SessionBooking's own comment on why a live join would be wrong
  // here). Contact info (delivery_info/phone_number) is still excluded
  // from the general column grant, same as before — this RPC is the
  // only way to read it, now keyed by booking_id and no longer status-
  // scoped, so it also covers this page's past-bookings list.
  const [{ data: clients }, { data: contactInfoRows }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    supabase.rpc("get_my_confirmed_bookings_contact_info") as unknown as Promise<{
      data: { booking_id: string; phone_number: string | null; meeting_link: string | null; delivery_info: string | null }[] | null;
    }>,
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.display_name ?? ""]));
  const contactInfoByBookingId = new Map((contactInfoRows ?? []).map((row) => [row.booking_id, row]));

  const mergedBookings: SessionBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    counterpartName: clientNameById.get(b.client_id) ?? "",
    serviceName: b.service_name,
    // Derived from the booking's own immutable start/end, not the
    // service's current duration_minutes — see client-dashboard/page.tsx's
    // identical comment.
    durationMinutes: Math.round((new Date(b.end_utc).getTime() - new Date(b.start_utc).getTime()) / 60000),
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    // Real DB domain is 5 values (see bookings_status_check); no cast
    // needed now that SessionBooking's own union matches it.
    status: b.status as SessionBooking["status"],
    deliveryType: b.delivery_type as SessionBooking["deliveryType"],
    deliveryInfo: contactInfoByBookingId.get(b.id)?.delivery_info ?? null,
    phoneNumber: contactInfoByBookingId.get(b.id)?.phone_number ?? null,
    priceCents: b.price_cents,
    currency: b.currency,
    createdAt: b.created_at,
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
          perspective="practitioner"
          timezone={practitionerProfile?.timezone ?? "Europe/Sofia"}
        />
      </div>
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { BookingsList, type SessionBooking } from "@/components/bookings/BookingsList";
import { splitUpcomingPast } from "@/lib/booking-time";

// Auth/role guard, and the "no bookings yet" activation branch, already
// ran in layout.tsx. Same fetch/merge shape as the Upcoming page
// (app/[locale]/client-dashboard/page.tsx) — each sidebar section fetches
// its own data independently, same pattern the practitioner dashboard's
// separate tab routes already use, rather than a shared loader neither
// side has today.
export default async function ClientPastPage() {
  const t = await getTranslations("Dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, practitioner_id, service_id, start_utc, end_utc, status")
    .eq("client_id", userId)
    .order("start_utc", { ascending: true });

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: services }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", practitionerIds),
    supabase.from("services").select("id, name, duration_minutes, delivery_type").in("id", serviceIds),
  ]);

  const { data: reviewedBookingRows } = (await supabase.rpc("get_my_reviewed_booking_ids")) as {
    data: { booking_id: string }[] | null;
  };
  const reviewedBookingIds = new Set((reviewedBookingRows ?? []).map((row) => row.booking_id));

  const practitionerNameById = new Map((practitioners ?? []).map((p) => [p.id, p.display_name ?? ""]));
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  const mergedBookings: SessionBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    counterpartName: practitionerNameById.get(b.practitioner_id) ?? "",
    serviceName: serviceById.get(b.service_id)?.name ?? "",
    durationMinutes: serviceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as SessionBooking["status"],
    deliveryType: (serviceById.get(b.service_id)?.delivery_type as "online" | "in_person" | null) ?? null,
    deliveryInfo: null,
    hasReview: reviewedBookingIds.has(b.id),
  }));

  const { past } = splitUpcomingPast(mergedBookings);

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("nav.clientPast")}</h1>
      <BookingsList
        upcoming={[]}
        past={past}
        perspective="client"
        showUpcomingSection={false}
        pastStartsExpanded
      />
    </main>
  );
}

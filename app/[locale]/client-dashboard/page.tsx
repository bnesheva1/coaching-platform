import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { BookingsList, type ClientBooking } from "./BookingsList";
import { splitUpcomingPast } from "@/lib/booking-time";

export default async function ClientDashboardPage() {
  const t = await getTranslations("Dashboard");
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client") {
    redirect({ href: "/practitioner-dashboard", locale });
    return null;
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, practitioner_id, service_id, start_utc, end_utc, status")
    .eq("client_id", user.id)
    .order("start_utc", { ascending: true });

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: services }] = await Promise.all([
    practitionerIds.length > 0
      ? supabase.from("profiles").select("id, display_name").in("id", practitionerIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    serviceIds.length > 0
      ? supabase.from("services").select("id, name, duration_minutes").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string; duration_minutes: number }[] }),
  ]);

  const practitionerNameById = new Map((practitioners ?? []).map((p) => [p.id, p.display_name ?? ""]));
  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));

  const mergedBookings: ClientBooking[] = (bookings ?? []).map((b) => ({
    id: b.id,
    practitionerName: practitionerNameById.get(b.practitioner_id) ?? "",
    serviceName: serviceById.get(b.service_id)?.name ?? "",
    durationMinutes: serviceById.get(b.service_id)?.duration_minutes ?? 0,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as ClientBooking["status"],
  }));

  const { upcoming, past } = splitUpcomingPast(mergedBookings);

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("clientTitle")}</h1>
      <form action={signOut}>
        <button type="submit">{t("signOut")}</button>
      </form>
      <BookingsList upcoming={upcoming} past={past} />
    </main>
  );
}

import { getTranslations, getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BookingsList, type SessionBooking } from "@/components/bookings/BookingsList";
import { type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { BookedWithGrid } from "./BookedWithGrid";
import { searchPractitioners } from "@/lib/practitioners/search";
import { splitUpcomingPast } from "@/lib/booking-time";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Auth/role guard already ran in layout.tsx — this page can assume
// `user` is a signed-in client.
export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getTranslations("Dashboard");
  const tBooking = await getTranslations("Booking");
  const tPublicProfile = await getTranslations("PublicProfile");
  const locale = (await getLocale()) as "bg" | "en";
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Guaranteed non-null by the layout guard.
  const userId = user!.id;

  const [{ data: profile }, { data: bookings }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
    supabase
      .from("bookings")
      .select("id, practitioner_id, service_id, start_utc, end_utc, status")
      .eq("client_id", userId)
      .order("start_utc", { ascending: true }),
  ]);

  const hasAnyBookingHistory = (bookings ?? []).length > 0;

  // Activation moment for a brand-new client — a welcoming CTA to
  // browse, not an empty sessions list dressed up to look intentional.
  // Matches Browse's own empty-state pattern (Card + single CTA), not
  // the practitioner dashboard's multi-step activation checklist, which
  // is specific to setting up a bookable profile and has no client
  // equivalent.
  if (!hasAnyBookingHistory) {
    return (
      <Card
        eyebrow={t("agenda.greeting", { name: profile?.display_name ?? "" })}
        title={t("clientEmptyState.title")}
        description={t("clientEmptyState.body")}
        footer={
          <Button href="/browse" size="md">
            {t("clientEmptyState.cta")}
          </Button>
        }
      />
    );
  }

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: practitionerNoticeSettings }, { data: services }, allPractitioners] =
    await Promise.all([
      supabase.from("profiles").select("id, display_name").in("id", practitionerIds),
      supabase.from("practitioner_profiles").select("id, min_notice_hours").in("id", practitionerIds),
      supabase.from("services").select("id, name, duration_minutes, delivery_type").in("id", serviceIds),
      // Full reuse of the same search this client would hit on /browse —
      // filtered down to just the practitioners they've booked, below.
      // No new query/RPC: average_rating/review_count are already
      // computed inside search_practitioners.
      searchPractitioners({}),
    ]);

  const { data: deliveryInfoRows } = (await supabase.rpc("get_my_active_booking_delivery_info")) as {
    data: { service_id: string; delivery_info: string | null }[] | null;
  };
  const deliveryInfoByServiceId = new Map((deliveryInfoRows ?? []).map((row) => [row.service_id, row.delivery_info]));

  const { data: reviewedBookingRows } = (await supabase.rpc("get_my_reviewed_booking_ids")) as {
    data: { booking_id: string }[] | null;
  };
  const reviewedBookingIds = new Set((reviewedBookingRows ?? []).map((row) => row.booking_id));

  const practitionerNameById = new Map((practitioners ?? []).map((p) => [p.id, p.display_name ?? ""]));
  const minNoticeHoursById = new Map((practitionerNoticeSettings ?? []).map((p) => [p.id, p.min_notice_hours]));
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
    deliveryInfo: deliveryInfoByServiceId.get(b.service_id) ?? null,
    minNoticeHours: minNoticeHoursById.get(b.practitioner_id) ?? 24,
    hasReview: reviewedBookingIds.has(b.id),
  }));

  const { upcoming, past } = splitUpcomingPast(mergedBookings);
  const nextBooking = upcoming[0] ?? null;

  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });

  // "Booked with" — most-recently-booked practitioner first (most
  // relevant for rebooking), derived entirely from the bookings already
  // fetched above, no separate tracking system.
  const lastBookedAtByPractitioner = new Map<string, string>();
  for (const b of bookings ?? []) {
    const existing = lastBookedAtByPractitioner.get(b.practitioner_id);
    if (!existing || b.start_utc > existing) {
      lastBookedAtByPractitioner.set(b.practitioner_id, b.start_utc);
    }
  }
  const specialtyLabelByKey = new Map(specialtiesData.map((s) => [s.key, s[locale] ?? s.en]));
  const topicLabelByKey = new Map(topicsData.map((topic) => [topic.key, topic[locale] ?? topic.en]));
  const bookedWithPractitioners: PractitionerCardData[] = allPractitioners
    .filter((p) => practitionerIds.includes(p.id))
    .sort(
      (a, b) =>
        (lastBookedAtByPractitioner.get(b.id) ?? "").localeCompare(lastBookedAtByPractitioner.get(a.id) ?? ""),
    )
    .map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      specialtyLabels: p.specialties.map((key) => specialtyLabelByKey.get(key) ?? key),
      topicLabels: p.topics.map((key) => topicLabelByKey.get(key) ?? key),
      averageRating: p.averageRating,
      reviewCount: p.reviewCount,
    }));

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode = typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
        {t("agenda.greeting", { name: profile?.display_name ?? "" })}
      </p>
      <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-1) 0 var(--space-6)" }}>{t("agenda.heading")}</h1>

      {justCancelled && (
        <p style={{ color: "green", marginBottom: "var(--space-4)" }}>{tBooking("cancelledMessage")}</p>
      )}
      {cancelErrorCode && (
        <p style={{ color: "crimson", marginBottom: "var(--space-4)" }}>
          {tBooking.has(cancelErrorCode) ? tBooking(cancelErrorCode as Parameters<typeof tBooking>[0]) : tBooking("cancellationFailed")}
        </p>
      )}

      {nextBooking && (
        <div style={{ marginBottom: "var(--space-6)" }}>
          <Card
            eyebrow={t("agenda.nextSessionEyebrow")}
            title={`${nextBooking.serviceName} — ${tBooking("withPractitioner", { name: nextBooking.counterpartName })}`}
            description={`${formatter.format(new Date(nextBooking.startUtc))} · ${tPublicProfile("serviceDuration", { minutes: nextBooking.durationMinutes })}`}
            footer={
              nextBooking.deliveryType === "online" && nextBooking.deliveryInfo ? (
                <a
                  href={nextBooking.deliveryInfo}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "var(--button-padding-md)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--accent)",
                    color: "var(--text-on-accent)",
                    font: "var(--text-button-md)",
                    textDecoration: "none",
                  }}
                >
                  {t("agenda.joinSession")}
                </a>
              ) : nextBooking.deliveryInfo ? (
                <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                  {tBooking("deliveryLabelInPerson")}: {nextBooking.deliveryInfo}
                </p>
              ) : null
            }
          />
        </div>
      )}

      <BookingsList upcoming={upcoming} past={past} perspective="client" />

      {bookedWithPractitioners.length > 0 && (
        <section style={{ marginTop: "var(--space-8)" }}>
          <h2 style={{ font: "var(--text-heading-md)", margin: "0 0 var(--space-4)" }}>{t("bookedWith.heading")}</h2>
          <BookedWithGrid practitioners={bookedWithPractitioners} />
        </section>
      )}

      <div style={{ marginTop: "var(--space-8)", display: "flex", justifyContent: "center" }}>
        <Button href="/browse" variant="secondary">
          {t("clientEmptyState.cta")}
        </Button>
      </div>
    </main>
  );
}

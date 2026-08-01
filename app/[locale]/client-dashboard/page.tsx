import { getTranslations, getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { BookingsList, ServiceImageSquare, PractitionerChip, type SessionBooking } from "@/components/bookings/BookingsList";
import { GreetingText } from "@/components/dashboard/GreetingText";
import { splitUpcomingPast, ACTIVE_STATUSES } from "@/lib/booking-time";
import rowStyles from "@/components/bookings/ResponsiveImageRow.module.css";
import { Button } from "@/components/ui/Button";
import { type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { BookedWithGrid } from "./BookedWithGrid";
import { searchPractitioners } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Auth/role guard, and the "no bookings yet" activation branch, already
// ran in layout.tsx — this page (the sidebar's "Предстоящи"/Upcoming
// section, and the dashboard's index route) can assume `user` is a
// signed-in client with at least one booking ever made.
export default async function ClientUpcomingPage({
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

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: practitionerSettings }, { data: services }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", practitionerIds),
    // avatar_url lives on practitioner_profiles, not profiles — same
    // query already fetching min_notice_hours, just widened rather
    // than adding a third round-trip for one more column.
    supabase.from("practitioner_profiles").select("id, min_notice_hours, avatar_url").in("id", practitionerIds),
    supabase.from("services").select("id, name, duration_minutes, delivery_type, image_url").in("id", serviceIds),
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
  const practitionerAvatarById = new Map((practitionerSettings ?? []).map((p) => [p.id, p.avatar_url ?? null]));
  const minNoticeHoursById = new Map((practitionerSettings ?? []).map((p) => [p.id, p.min_notice_hours]));
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
    counterpartAvatarUrl: practitionerAvatarById.get(b.practitioner_id) ?? null,
    serviceImageUrl: serviceById.get(b.service_id)?.image_url ?? null,
  }));

  const { upcoming, past } = splitUpcomingPast(mergedBookings);
  // upcoming[0] alone isn't safe: it's ordered purely by start_utc, so a
  // cancelled booking that happens to share its slot's original time
  // with an active one (routine once a slot gets rebooked after a
  // cancellation) could sort first and get shown as "next" even though
  // there's nothing to attend. The hero must be the earliest booking
  // that's actually still happening.
  const nextBooking = upcoming.find((b) => ACTIVE_STATUSES.has(b.status)) ?? null;

  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode = typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  // "Моите практикуващи" — now a section on this same page rather than
  // its own route. Full reuse of the same search a client would hit on
  // /browse, filtered down to just who they've booked — no new query
  // for the practitioner-id list either, `bookings` above already has
  // practitioner_id/start_utc for every booking this client has ever
  // made.
  const allPractitioners = await searchPractitioners({});
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

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
        <GreetingText name={profile?.display_name ?? ""} />
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
          {/* Hand-rolled rather than <Card>: Card's title/description
              props are plain strings, and this needs a leading service
              image beside a multi-row column. Same visual recipe as
              Card (border-subtle/radius-xl/shadow-md/space-8) so it
              stays the page's most prominent surface, just restructured
              internally. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-5)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-md)",
              padding: "var(--space-8)",
            }}
          >
            {/* Headline sits above the image+content row (not tucked
                beside it in the content column) — it labels the whole
                card, image included, not just the text half. */}
            <span style={{ font: "var(--text-overline)", letterSpacing: "var(--letter-overline)", textTransform: "uppercase", color: "var(--accent)" }}>
              {t("agenda.nextSessionEyebrow")}
            </span>

            <div className={rowStyles.row} style={{ gap: "var(--space-5)" }}>
              <ServiceImageSquare imageUrl={nextBooking.serviceImageUrl} size={140} />

              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {/* Matches the practitioner dashboard's own next-session
                    card structure (plain date/duration, message-count
                    placeholder) — the client's preferred, simpler read —
                    but keeps the practitioner mini-tile next to the
                    service name rather than a plain name string. Stacks
                    (chip full width) on mobile, same as the upcoming
                    list cards. */}
                <div className={rowStyles.stackRow} style={{ gap: "var(--space-2)" }}>
                  <h3 style={{ margin: 0, font: "var(--text-heading-lg)" }}>
                    {nextBooking.serviceName} {tBooking("withInline")}
                  </h3>
                  <PractitionerChip name={nextBooking.counterpartName} avatarUrl={nextBooking.counterpartAvatarUrl} />
                </div>
                <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
                  {formatter.format(new Date(nextBooking.startUtc))} ·{" "}
                  {tPublicProfile("serviceDuration", { minutes: nextBooking.durationMinutes })}
                </p>

                {/* Placeholder — no messaging feature exists anywhere in
                    this app yet, same reasoning as the identical spot on
                    the practitioner dashboard; always 0 for now. */}
                <span
                  aria-label={t("agenda.messagesFromPractitioner", { count: 0 })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    font: "var(--text-body-sm)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <span aria-hidden style={{ font: "var(--text-icon)" }}>💬</span>
                  0
                </span>

                {/* Join button/location sits directly under the message
                    line. Full width on mobile via .tile, content-sized
                    on desktop. */}
                {nextBooking.deliveryType === "online" && nextBooking.deliveryInfo ? (
                  <a
                    href={nextBooking.deliveryInfo}
                    target="_blank"
                    rel="noreferrer"
                    className={rowStyles.tile}
                    style={{
                      alignSelf: "flex-start",
                      display: "inline-block",
                      textAlign: "center",
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
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* One scrollable screen — Upcoming, Past (collapsed), and My
          practitioners all live here now; the sidebar's "Минали"/
          "Моите практикуващи" links just scroll to #past/#practitioners
          rather than navigating to their own routes. Unlike the
          practitioner dashboard (many distinct settings screens, a real
          fit for tabs), the client side only has bookings-related
          content today — one page is the simpler, more honest shape. */}
      <BookingsList
        upcoming={nextBooking ? upcoming.filter((b) => b.id !== nextBooking.id) : upcoming}
        past={past}
        perspective="client"
        premium
        nextSessionShownSeparately={nextBooking !== null}
        pastSectionId="past"
      />

      <section style={{ marginTop: "var(--space-8)" }} id="practitioners">
        <h2 style={{ margin: "0 0 var(--space-4)", font: "var(--text-heading-md)" }}>{t("nav.clientPractitioners")}</h2>
        <BookedWithGrid practitioners={bookedWithPractitioners} />
        <div style={{ marginTop: "var(--space-6)", display: "flex", justifyContent: "center" }}>
          <Button href="/browse" variant="secondary">
            {t("clientEmptyState.cta")}
          </Button>
        </div>
      </section>
    </main>
  );
}

import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { BookingsList, ServiceImageSquare, PractitionerChip, type SessionBooking } from "@/components/bookings/BookingsList";
import { NextSessionCancelAction } from "@/components/bookings/NextSessionCancelAction";
import { GreetingText } from "@/components/dashboard/GreetingText";
import { ClientLocalTime, ClientTimezoneNotice } from "@/components/dashboard/ClientTimezone";
import { getSavedTimezone } from "@/lib/profile/savedTimezone";
import { splitUpcomingPast, ACTIVE_STATUSES } from "@/lib/booking-time";
import rowStyles from "@/components/bookings/ResponsiveImageRow.module.css";
import { Button } from "@/components/ui/Button";
import { type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { BookedWithGrid } from "./BookedWithGrid";
import { ClientActivationState } from "./ClientActivationState";
import { searchPractitioners } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// Auth/role guard already ran in layout.tsx. The "no bookings yet"
// activation branch used to run there too, unconditionally substituting
// ClientActivationState for every route under this layout — moved here
// instead (see layout.tsx's own comment on why) since this is the only
// route it actually applies to; a client with no bookings yet still
// needs every other route (settings, above all) to render normally.
export default async function ClientUpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getTranslations("Dashboard");
  const tBooking = await getTranslations("Booking");
  const tPublicProfile = await getTranslations("PublicProfile");
  const locale = (await getLocale()) as "bg" | "en";
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
      .select("id, practitioner_id, service_id, start_utc, end_utc, status, service_name, delivery_type, price_cents, currency, created_at")
      .eq("client_id", userId)
      .order("start_utc", { ascending: true }),
  ]);

  if ((bookings ?? []).length === 0) {
    return <ClientActivationState displayName={profile?.display_name ?? ""} />;
  }

  const practitionerIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id))];
  const serviceIds = [...new Set((bookings ?? []).map((b) => b.service_id))];

  const [{ data: practitioners }, { data: practitionerSettings }, { data: services }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", practitionerIds),
    // avatar_url lives on practitioner_profiles, not profiles — same
    // query already fetching min_notice_hours, just widened rather
    // than adding a third round-trip for one more column.
    supabase.from("practitioner_profiles").select("id, min_notice_hours, avatar_url").in("id", practitionerIds),
    // Only image_url comes from a live services join now — name/
    // duration/delivery_type are booking-time snapshots (see
    // SessionBooking's own comment on why), read straight off `bookings`
    // above instead. image_url has no snapshot equivalent and isn't
    // part of "what was agreed", so a live join is the right call for it.
    supabase.from("services").select("id, image_url").in("id", serviceIds),
  ]);

  // Booking-time snapshot, not a live join — same RPC now also backs the
  // practitioner Sessions screen. Keyed by booking_id (not service_id
  // like the old get_my_active_booking_delivery_info this replaces),
  // and no longer status-scoped, so it works for past bookings too.
  const { data: contactInfoRows } = (await supabase.rpc("get_my_confirmed_bookings_contact_info")) as {
    data: { booking_id: string; phone_number: string | null; meeting_link: string | null; delivery_info: string | null }[] | null;
  };
  const contactInfoByBookingId = new Map((contactInfoRows ?? []).map((row) => [row.booking_id, row]));

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
    serviceName: b.service_name,
    // Derived from the booking's own immutable start/end, not the
    // service's current duration_minutes — a service's duration can be
    // edited after this booking was made; its own start/end never can.
    durationMinutes: Math.round((new Date(b.end_utc).getTime() - new Date(b.start_utc).getTime()) / 60000),
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    status: b.status as SessionBooking["status"],
    deliveryType: b.delivery_type as SessionBooking["deliveryType"],
    deliveryInfo: contactInfoByBookingId.get(b.id)?.delivery_info ?? null,
    phoneNumber: contactInfoByBookingId.get(b.id)?.phone_number ?? null,
    priceCents: b.price_cents,
    currency: b.currency,
    createdAt: b.created_at,
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

  // The client's own timezone for display: their saved profiles.timezone
  // wins, resolved client-side (falling back to the browser guess, then
  // UTC) inside ClientLocalTime/ClientTimezoneNotice — never formatted
  // server-side, which rendered in the server's zone (UTC on Vercel).
  // Read via service role because timezone is excluded from the client
  // column grant (see getSavedTimezone).
  const savedTz = await getSavedTimezone(userId);

  const justCancelled = resolvedSearchParams.cancelled === "1";
  const cancelErrorCode = typeof resolvedSearchParams.cancelError === "string" ? resolvedSearchParams.cancelError : null;

  // "Моите практикуващи" — now a section on this same page rather than
  // its own route. Full reuse of the same search a client would hit on
  // /browse, filtered down to just who they've booked — no new query
  // for the practitioner-id list either, `bookings` above already has
  // practitioner_id/start_utc for every booking this client has ever
  // made. onlyBookable: false — this is booking HISTORY, not discovery;
  // a practitioner going unbookable later must not make them silently
  // vanish from a client's own "who I've worked with" list.
  const allPractitioners = await searchPractitioners({ onlyBookable: false });
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
      <h1 style={{ font: "var(--text-heading-lg)", margin: "var(--space-1) 0 var(--space-2)" }}>{t("agenda.heading")}</h1>
      <ClientTimezoneNotice savedTimezone={savedTz} />

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
                  <ClientLocalTime iso={nextBooking.startUtc} savedTimezone={savedTz} /> ·{" "}
                  {tPublicProfile("serviceDuration", { minutes: nextBooking.durationMinutes })}
                </p>

                {/* Join button/location sits directly under the message
                    line. Full width on mobile via .tile, content-sized
                    on desktop. */}
                {nextBooking.deliveryType === "online" ? (
                  // Online sessions always use the in-app video room — same
                  // tab, seamless. The session route itself gates on the
                  // join window (countdown if early), so linking any time
                  // before the session is fine.
                  <Link
                    href={`/session/${nextBooking.id}`}
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
                  </Link>
                ) : nextBooking.deliveryInfo ? (
                  <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                    {tBooking("deliveryLabelInPerson")}: {nextBooking.deliveryInfo}
                  </p>
                ) : null}

                {/* This card is the only place a client with exactly one
                    upcoming booking ever sees it — BookingsList's own
                    upcoming list deliberately excludes whichever booking
                    is shown here, to avoid showing it twice. Without this,
                    that common case had no way to cancel at all. */}
                <div style={{ alignSelf: "flex-end" }}>
                  <NextSessionCancelAction
                    bookingId={nextBooking.id}
                    counterpartName={nextBooking.counterpartName}
                    startUtc={nextBooking.startUtc}
                    minNoticeHours={nextBooking.minNoticeHours ?? 24}
                  />
                </div>
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
        timezone={savedTz ?? undefined}
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

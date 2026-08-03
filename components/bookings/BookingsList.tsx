"use client";

import { Fragment, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CancelSessionDialog } from "./CancelSessionDialog";
import { PastSessionsSection } from "./PastSessionsSection";
import { cancelBookingAsPractitioner } from "@/app/[locale]/practitioner-dashboard/cancel-booking-actions";
import { cancelBookingAsClient } from "@/app/[locale]/client-dashboard/cancel-booking-actions";
import { isPastCancellationCutoff, ACTIVE_STATUSES, CANCELLED_STATUSES } from "@/lib/booking-time";
import { splitTextAndUrls } from "@/lib/linkify";
import rowStyles from "./ResponsiveImageRow.module.css";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Decorative dimension, not a spacing value — same reasoning as
// PractitionerCard's own AVATAR_SIZE constant, just smaller: this sits
// in a horizontal list row next to text, not a vertical profile-grid
// card where the photo is the focal point.
const AVATAR_SIZE = 56;

// completed is a real, reachable status (the Epic 8 auto-complete cron
// sets it once a session's end_utc passes). The self-cancelled case is
// the one place the label genuinely depends on perspective — a
// practitioner sees their own cancellation as "cancelled by you", and so
// does a client for theirs; each sees the OTHER party's cancellation in
// the third person.
export const STATUS_KEYS = {
  practitioner: {
    pending: "statusPending",
    confirmed: "statusConfirmed",
    completed: "statusCompleted",
    cancelled_by_client: "statusCancelledByClient",
    cancelled_by_practitioner: "statusCancelledByYou",
  },
  client: {
    pending: "statusPending",
    confirmed: "statusConfirmed",
    completed: "statusCompleted",
    cancelled_by_client: "statusCancelledByYou",
    cancelled_by_practitioner: "statusCancelledByPractitioner",
  },
} as const;

// Re-exported (not just imported) so PastSessionsSection.tsx's existing
// `from "./BookingsList"` import keeps working unchanged — the actual
// definitions moved to lib/booking-time.ts, see the comment there.
export { ACTIVE_STATUSES, CANCELLED_STATUSES };

export type BookingPerspective = "practitioner" | "client";

// "withClient"/"withPractitioner" — reused by PastSessionsSection so the
// counterpart label logic lives in exactly one place.
export const COUNTERPART_LABEL_KEY = {
  practitioner: "withClient",
  client: "withPractitioner",
} as const;

// One shared shape for both dashboards. counterpartName is "the
// practitioner" from a client's row and "the client" from a
// practitioner's row — each page's own query maps its raw booking rows
// onto this before handing them to BookingsList. minNoticeHours/hasReview
// are only ever populated (and only ever read) on the client path.
export type SessionBooking = {
  id: string;
  counterpartName: string;
  // serviceName/durationMinutes/deliveryType/deliveryInfo are all booking-
  // time snapshots now (bookings.service_name, end_utc-start_utc,
  // bookings.delivery_type, the get_my_confirmed_bookings_contact_info
  // RPC) — never a live join to the current services row. That's the
  // whole point of the expandable details section below: editing or
  // hiding a service later must not change what an already-booked
  // session shows.
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "completed" | "cancelled_by_client" | "cancelled_by_practitioner";
  deliveryType: "online" | "in_person" | "phone" | null;
  deliveryInfo: string | null;
  // Phone-type bookings carry their contact number here instead of
  // deliveryInfo (mirrors services' own online/in_person vs phone
  // split) — only ever populated when deliveryType === "phone".
  phoneNumber?: string | null;
  priceCents: number;
  currency: string;
  createdAt: string;
  minNoticeHours?: number;
  hasReview?: boolean;
  // Only ever populated on the client path (a client's counterpart is a
  // practitioner, who has a public-facing photo). Left undefined on the
  // practitioner path — a client's own avatar isn't fetched there today,
  // and the compact (non-premium) card doesn't render one anyway.
  counterpartAvatarUrl?: string | null;
  // Client path only, same reasoning as counterpartAvatarUrl — currently
  // only consumed by the client dashboard's own next-session hero
  // (hand-rolled in that page, not by BookingsList's own card markup).
  serviceImageUrl?: string | null;
};

// Same useSyncExternalStore pattern as SlotPicker.tsx/TimezoneField.tsx —
// the browser's timezone can't be known during SSR, so the server and
// client snapshots must differ safely rather than via useEffect+setState.
function subscribeToNothing() {
  return () => {};
}
function getDetectedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
function getServerTimezoneSnapshot(): string | null {
  return null;
}

function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitTextAndUrls(text).map((segment, i) =>
        segment.type === "url" ? (
          <a key={i} href={segment.value} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            {segment.value}
          </a>
        ) : (
          <Fragment key={i}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}

// Same fallback recipe as PractitionerCard's own avatar treatment
// (initial letter over a quiet gradient) — a booking's counterpart
// photo is the norm on the client dashboard, so the fallback stays
// deliberately muted rather than competing with photo cards in the
// same list.
// Exported for the client dashboard's own next-session hero, which
// needs this exact fallback/photo treatment at a larger size — not
// reimplemented there as a second copy.
export function CounterpartAvatar({
  name,
  avatarUrl,
  size = AVATAR_SIZE,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt=""
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  ) : (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: "linear-gradient(160deg, var(--bg-sunken), var(--bg-surface-2))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--accent-subtle-text)",
        opacity: 0.7,
        font: `600 ${size * 0.42}px var(--font-display)`,
      }}
    >
      {initial}
    </div>
  );
}

// Same square-thumbnail recipe as the service tiles on the practitioner
// profile page (aspect-ratio 1/1, radius-lg, gradient fallback) —
// reused, not reinvented. Shared by the client dashboard's next-session
// hero (size 140) and BookingsList's own premium cards (size 96) so the
// two surfaces stay visually identical, not two hand-copied variants
// that can drift.
export function ServiceImageSquare({ imageUrl, size }: { imageUrl?: string | null; size: number }) {
  return (
    <div
      className={rowStyles.tile}
      style={
        {
          "--tile-size": `${size}px`,
          aspectRatio: "1 / 1",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: imageUrl ? undefined : "linear-gradient(135deg, var(--bg-sunken), var(--accent-glow))",
        } as React.CSSProperties
      }
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </div>
  );
}

// The small bordered avatar+name card used wherever a practitioner's
// identity needs to read as a distinct fact from the surrounding
// service/time text, not folded into a heading. Same fixed 32px avatar
// in both the hero and the list cards — this is always a secondary
// identity marker, never the card's own focal image.
export function PractitionerChip({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <div
      className={rowStyles.tile}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-3)",
        background: "var(--bg-surface-2)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-4) var(--space-2) var(--space-2)",
      }}
    >
      <CounterpartAvatar name={name} avatarUrl={avatarUrl} size={32} />
      <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{name}</span>
    </div>
  );
}

// Native <details>/<summary>, same idiom PastSessionsSection.tsx already
// established for its own collapse — free keyboard operability and an
// expanded/collapsed announcement to screen readers with no extra aria
// wiring, and consistent with the one other disclosure pattern already
// in this app rather than a second, custom one. Collapsed by default
// everywhere it's used (no defaultOpen) — this is deliberately the
// "agreed terms" record, not primary card content, so it stays out of
// the way until asked for.
//
// Every field here is a booking-time snapshot — never a live join to
// the current services row — which is the entire point: a practitioner
// editing or hiding a service after the fact must not change what an
// already-booked session appears to have been. serviceName/
// durationMinutes/deliveryType/deliveryInfo/priceCents/currency/
// createdAt all come straight through from the SessionBooking passed
// in, which each page maps from bookings' own snapshot columns (or, for
// duration, from the booking's own immutable start/end) — never from a
// second services query.
export function BookingDetailsDisclosure({ booking, timezone }: { booking: SessionBooking; timezone: string }) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  const priceFormatter = new Intl.NumberFormat(intlLocale, { style: "currency", currency: booking.currency });
  const createdAtFormatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  const deliveryTypeLabel =
    booking.deliveryType === "online"
      ? t("deliveryTypeOnline")
      : booking.deliveryType === "in_person"
        ? t("deliveryTypeInPerson")
        : booking.deliveryType === "phone"
          ? t("deliveryTypePhone")
          : null;

  const deliveryDetailsLabel =
    booking.deliveryType === "online"
      ? t("deliveryLabelOnline")
      : booking.deliveryType === "in_person"
        ? t("deliveryLabelInPerson")
        : booking.deliveryType === "phone"
          ? t("deliveryLabelPhone")
          : null;

  const deliveryDetailsValue = booking.deliveryType === "phone" ? booking.phoneNumber : booking.deliveryInfo;

  const rowStyle = { display: "flex", gap: "var(--space-3)" } as const;
  const labelStyle = { margin: 0, minWidth: 140, flexShrink: 0, color: "var(--text-tertiary)" } as const;
  const valueStyle = { margin: 0, color: "var(--text-secondary)" } as const;

  return (
    <details style={{ marginTop: "var(--space-2)" }}>
      <summary
        className="focus-ring"
        style={{ cursor: "pointer", font: "var(--text-body-sm)", color: "var(--accent)", padding: "var(--space-1) 0" }}
      >
        {t("detailsToggle")}
      </summary>
      <dl style={{ margin: "var(--space-2) 0 0", display: "flex", flexDirection: "column", gap: "var(--space-1)", font: "var(--text-body-sm)" }}>
        <div style={rowStyle}>
          <dt style={labelStyle}>{t("detailsServiceLabel")}</dt>
          <dd style={valueStyle}>{booking.serviceName}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={labelStyle}>{t("detailsPriceLabel")}</dt>
          <dd style={valueStyle}>{priceFormatter.format(booking.priceCents / 100)}</dd>
        </div>
        <div style={rowStyle}>
          <dt style={labelStyle}>{t("detailsDurationLabel")}</dt>
          <dd style={valueStyle}>{t("detailsDurationValue", { minutes: booking.durationMinutes })}</dd>
        </div>
        {deliveryTypeLabel && (
          <div style={rowStyle}>
            <dt style={labelStyle}>{t("detailsDeliveryTypeLabel")}</dt>
            <dd style={valueStyle}>{deliveryTypeLabel}</dd>
          </div>
        )}
        {deliveryDetailsValue && (
          <div style={rowStyle}>
            <dt style={labelStyle}>{deliveryDetailsLabel}</dt>
            <dd style={valueStyle}>
              <LinkifiedText text={deliveryDetailsValue} />
            </dd>
          </div>
        )}
        <div style={rowStyle}>
          <dt style={labelStyle}>{t("detailsBookedAtLabel")}</dt>
          <dd style={valueStyle}>{createdAtFormatter.format(new Date(booking.createdAt))}</dd>
        </div>
      </dl>
    </details>
  );
}

export function BookingsList({
  upcoming,
  past,
  perspective,
  // The practitioner's timezone is already known server-side
  // (practitioner_profiles.timezone) and passed in directly; omitted
  // entirely for the client dashboard, whose only reliable timezone is
  // whatever the browser reports (profiles.timezone is frequently unset
  // for clients — see the Email-notifications-epic gap this mirrors).
  timezone,
  // Client dashboard only: the premium, photo-led treatment matching
  // the browse/"practitioners you've worked with" cards on that same
  // page. Left false (the original compact/functional row) for the
  // practitioner dashboard's own bookings tab, which this component
  // still serves unchanged — that surface wasn't part of this request.
  premium = false,
  // True when the caller already renders the next upcoming session
  // elsewhere (the client dashboard's own hero card) and has excluded
  // it from `upcoming` to avoid showing the same session twice. Only
  // affects the empty-state message: "No upcoming bookings" would be
  // wrong here, since there IS one — it's just shown above, not in
  // this list.
  nextSessionShownSeparately = false,
  // Client dashboard only: its Upcoming/Past sidebar sections each
  // render this component for just one half — the practitioner
  // dashboard's own combined "Сесии" tab (and the client dashboard
  // before this sidebar existed) always wants both, so both default to
  // true, unchanged for every other existing caller.
  showUpcomingSection = true,
  showPastSection = true,
  // The client dashboard's dedicated Past page starts this expanded —
  // there's no reason to require an extra click to see past sessions on
  // a page you navigated to specifically to see them. The practitioner
  // dashboard's combined tab (past sessions are secondary there) keeps
  // the default collapsed state.
  pastStartsExpanded = false,
  // Anchor target for the client dashboard sidebar's "Минали" link, now
  // that Past is a section on one scrollable page rather than its own
  // route. Passed straight through to PastSessionsSection.
  pastSectionId,
}: {
  upcoming: SessionBooking[];
  past: SessionBooking[];
  perspective: BookingPerspective;
  timezone?: string;
  premium?: boolean;
  nextSessionShownSeparately?: boolean;
  showUpcomingSection?: boolean;
  showPastSection?: boolean;
  pastStartsExpanded?: boolean;
  pastSectionId?: string;
}) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  const detectedTimezone = useSyncExternalStore(subscribeToNothing, getDetectedTimezone, getServerTimezoneSnapshot);
  const effectiveTimezone = timezone ?? detectedTimezone ?? "UTC";

  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: effectiveTimezone,
  });

  const counterpartLabelKey = COUNTERPART_LABEL_KEY[perspective];
  const statusKeys = STATUS_KEYS[perspective];

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ margin: "0 0 var(--space-2)", font: "var(--text-heading-md)" }}>{t("bookingsTitle")}</h2>
      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("timesShownIn", { timezone: effectiveTimezone })}
      </p>

      {showUpcomingSection && (
        <>
          <h3 style={{ margin: "var(--space-6) 0 var(--space-3)", font: "var(--text-heading-sm)" }}>{t("upcomingHeading")}</h3>
          {upcoming.length === 0 ? (
        nextSessionShownSeparately ? null : (
          <p style={{ color: "var(--text-secondary)" }}>{t("noUpcomingBookings")}</p>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: premium ? "var(--space-4)" : "var(--space-3)" }}>
          {upcoming.map((booking) => {
            const sessionTimeLabel = formatter.format(new Date(booking.startUtc));
            const isPastCutoff =
              perspective === "client" &&
              isPastCancellationCutoff(booking.startUtc, booking.minNoticeHours ?? 24);

            // Unwrapped — the compact card wraps this in its own trailing
            // full-width row (cancelSlot, below); the premium card
            // instead places it directly on the practitioner chip's own
            // row, reserving that row's trailing space for it whether
            // or not a session actually turns out to be cancellable.
            const cancelAction = ACTIVE_STATUSES.has(booking.status) && (
              perspective === "practitioner" ? (
                <CancelSessionDialog
                  counterpartName={booking.counterpartName}
                  sessionTimeLabel={sessionTimeLabel}
                  perspective="practitioner"
                  action={cancelBookingAsPractitioner.bind(null, booking.id)}
                />
              ) : isPastCutoff ? (
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {t("cancelWindowNote", { hours: booking.minNoticeHours ?? 24 })}
                </span>
              ) : (
                <CancelSessionDialog
                  counterpartName={booking.counterpartName}
                  sessionTimeLabel={sessionTimeLabel}
                  perspective="client"
                  action={cancelBookingAsClient.bind(null, booking.id, effectiveTimezone)}
                />
              )
            );
            const cancelSlot = cancelAction && (
              <div style={{ marginTop: "var(--space-3)", display: "flex", justifyContent: "flex-end" }}>
                {cancelAction}
              </div>
            );

            // Lighter affordance than a filled block, deliberately: on a
            // premium card the imminent session already has "Join
            // session" as a real button in the dashboard hero, so this
            // is a quiet reference line on every other card, not a
            // second competing CTA.
            const deliverySlot = booking.deliveryInfo && (
              <p
                style={{
                  margin: `${premium ? "var(--space-2)" : "var(--space-3)"} 0 0`,
                  font: "var(--text-body-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ color: "var(--text-tertiary)" }}>
                  {booking.deliveryType === "online" ? t("deliveryLabelOnline") : t("deliveryLabelInPerson")}:
                </span>{" "}
                <LinkifiedText text={booking.deliveryInfo} />
              </p>
            );

            if (premium) {
              // Same structural pattern as the client dashboard's next-
              // session hero (image, then time/name/identity stacked) —
              // just without its "next session" eyebrow, which only
              // makes sense once per page, and at the smaller type
              // scale this list already used before the hero existed.
              return (
                <div
                  key={booking.id}
                  className={rowStyles.row}
                  style={{
                    gap: "var(--space-4)",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-2xl)",
                    padding: "var(--space-6)",
                  }}
                >
                  <ServiceImageSquare imageUrl={booking.serviceImageUrl} size={96} />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {/* Same row-on-desktop/stack-on-mobile breakpoint as
                        the image+content split above, reused here for
                        the date/status pairing — the middot separator
                        only renders when they're actually on one line. */}
                    <div className={rowStyles.row} style={{ gap: "var(--space-2)", alignItems: "baseline" }}>
                      <strong style={{ font: "var(--text-body-md)" }}>{sessionTimeLabel}</strong>
                      <span className={rowStyles.inlineSeparator} style={{ color: "var(--text-tertiary)" }} aria-hidden="true">
                        ·
                      </span>
                      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                        {t(statusKeys[booking.status])}
                      </p>
                    </div>
                    {/* Same service-name+chip row as the hero ("[service]
                        with [chip]"), just at this list's existing
                        smaller heading-sm size — not the hero's bigger
                        heading-lg. Stacks (chip full width) on mobile. */}
                    <div className={rowStyles.stackRow} style={{ gap: "var(--space-2)" }}>
                      <p style={{ margin: 0, font: "var(--text-heading-sm)", color: "var(--text-primary)" }}>
                        {booking.serviceName} {t("withInline")}
                      </p>
                      <PractitionerChip name={booking.counterpartName} avatarUrl={booking.counterpartAvatarUrl} />
                    </div>
                    {/* Join link/location sits directly under that row. */}
                    {deliverySlot}
                    <BookingDetailsDisclosure booking={booking} timezone={effectiveTimezone} />
                    {cancelSlot}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={booking.id}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-4)",
                }}
              >
                <strong style={{ font: "var(--text-body-md)" }}>{sessionTimeLabel}</strong>
                <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-secondary)" }}>
                  {t(counterpartLabelKey, { name: booking.counterpartName })}
                </p>
                <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {booking.serviceName} · {t(statusKeys[booking.status])}
                </p>
                {deliverySlot}
                <BookingDetailsDisclosure booking={booking} timezone={effectiveTimezone} />
                {cancelSlot}
              </div>
            );
          })}
        </div>
          )}
        </>
      )}

      {showPastSection && (
        <PastSessionsSection
          bookings={past}
          timezone={effectiveTimezone}
          perspective={perspective}
          defaultOpen={pastStartsExpanded}
          id={pastSectionId}
        />
      )}
    </section>
  );
}

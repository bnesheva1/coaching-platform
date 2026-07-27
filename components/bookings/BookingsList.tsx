"use client";

import { Fragment, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CancelSessionDialog } from "./CancelSessionDialog";
import { PastSessionsSection } from "./PastSessionsSection";
import { cancelBookingAsPractitioner } from "@/app/[locale]/practitioner-dashboard/cancel-booking-actions";
import { cancelBookingAsClient } from "@/app/[locale]/client-dashboard/cancel-booking-actions";
import { isPastCancellationCutoff, ACTIVE_STATUSES, CANCELLED_STATUSES } from "@/lib/booking-time";
import { splitTextAndUrls } from "@/lib/linkify";

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
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "completed" | "cancelled_by_client" | "cancelled_by_practitioner";
  deliveryType: "online" | "in_person" | null;
  deliveryInfo: string | null;
  minNoticeHours?: number;
  hasReview?: boolean;
  // Only ever populated on the client path (a client's counterpart is a
  // practitioner, who has a public-facing photo). Left undefined on the
  // practitioner path — a client's own avatar isn't fetched there today,
  // and the compact (non-premium) card doesn't render one anyway.
  counterpartAvatarUrl?: string | null;
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
}: {
  upcoming: SessionBooking[];
  past: SessionBooking[];
  perspective: BookingPerspective;
  timezone?: string;
  premium?: boolean;
  nextSessionShownSeparately?: boolean;
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
      <h2 style={{ font: "var(--text-heading-md)" }}>{t("bookingsTitle")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
        {t("timesShownIn", { timezone: effectiveTimezone })}
      </p>

      <h3 style={{ font: "var(--text-heading-sm)" }}>{t("upcomingHeading")}</h3>
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

            const cancelSlot = ACTIVE_STATUSES.has(booking.status) && (
              <div style={{ marginTop: "var(--space-3)", display: "flex", justifyContent: "flex-end" }}>
                {perspective === "practitioner" ? (
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
                )}
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
              return (
                <div
                  key={booking.id}
                  style={{
                    display: "flex",
                    gap: "var(--space-4)",
                    alignItems: "flex-start",
                    background: "var(--bg-surface)",
                    borderRadius: "var(--radius-2xl)",
                    boxShadow: "var(--shadow-card)",
                    padding: "var(--space-6)",
                  }}
                >
                  <CounterpartAvatar name={booking.counterpartName} avatarUrl={booking.counterpartAvatarUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ font: "var(--text-body-md)" }}>{sessionTimeLabel}</strong>
                    <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-heading-sm)", color: "var(--text-primary)" }}>
                      {t(counterpartLabelKey, { name: booking.counterpartName })}
                    </p>
                    <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                      {booking.serviceName} · {t(statusKeys[booking.status])}
                    </p>
                    {deliverySlot}
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
                {cancelSlot}
              </div>
            );
          })}
        </div>
      )}

      <PastSessionsSection bookings={past} timezone={effectiveTimezone} perspective={perspective} />
    </section>
  );
}

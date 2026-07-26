"use client";

import { Fragment, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CancelSessionDialog } from "./CancelSessionDialog";
import { PastSessionsSection } from "./PastSessionsSection";
import { cancelBookingAsPractitioner } from "@/app/[locale]/practitioner-dashboard/cancel-booking-actions";
import { cancelBookingAsClient } from "@/app/[locale]/client-dashboard/cancel-booking-actions";
import { isPastCancellationCutoff } from "@/lib/booking-time";
import { splitTextAndUrls } from "@/lib/linkify";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

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

export const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);
export const CANCELLED_STATUSES = new Set(["cancelled_by_client", "cancelled_by_practitioner"]);

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
          <a key={i} href={segment.value} target="_blank" rel="noreferrer">
            {segment.value}
          </a>
        ) : (
          <Fragment key={i}>{segment.value}</Fragment>
        ),
      )}
    </>
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
}: {
  upcoming: SessionBooking[];
  past: SessionBooking[];
  perspective: BookingPerspective;
  timezone?: string;
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
        <p style={{ color: "var(--text-secondary)" }}>{t("noUpcomingBookings")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {upcoming.map((booking) => {
            const sessionTimeLabel = formatter.format(new Date(booking.startUtc));
            const isPastCutoff =
              perspective === "client" &&
              isPastCancellationCutoff(booking.startUtc, booking.minNoticeHours ?? 24);

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
                {booking.deliveryInfo && (
                  <p
                    style={{
                      margin: "var(--space-3) 0 0",
                      background: "var(--bg-surface-2)",
                      padding: "var(--space-2) var(--space-3)",
                      borderRadius: "var(--radius-sm)",
                      font: "var(--text-body-sm)",
                    }}
                  >
                    <strong>
                      {booking.deliveryType === "online" ? t("deliveryLabelOnline") : t("deliveryLabelInPerson")}:
                    </strong>{" "}
                    <LinkifiedText text={booking.deliveryInfo} />
                  </p>
                )}
                {ACTIVE_STATUSES.has(booking.status) && (
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
                )}
              </div>
            );
          })}
        </div>
      )}

      <PastSessionsSection bookings={past} timezone={effectiveTimezone} perspective={perspective} />
    </section>
  );
}

"use client";

import { Fragment, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { cancelBookingAsClient } from "./cancel-booking-actions";
import { LeaveReviewForm } from "./LeaveReviewForm";
import { isPastCancellationCutoff } from "@/lib/booking-time";
import { splitTextAndUrls } from "@/lib/linkify";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

const STATUS_KEYS = {
  pending: "statusPending",
  confirmed: "statusConfirmed",
  cancelled_by_client: "statusCancelledByClient",
  cancelled_by_practitioner: "statusCancelledByPractitioner",
  completed: "statusCompleted",
} as const;

const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);

// Same useSyncExternalStore pattern as SlotPicker.tsx / TimezoneField.tsx —
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

export type ClientBooking = {
  id: string;
  practitionerName: string;
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "cancelled_by_client" | "cancelled_by_practitioner" | "completed";
  // Per-booking, not per-list — a client can have bookings with
  // different practitioners on different notice settings.
  minNoticeHours: number;
  // deliveryInfo is null whenever this booking isn't active (see
  // get_my_active_booking_delivery_info in page.tsx) OR the service
  // predates this feature — both render the same way, no info shown.
  deliveryType: "online" | "in_person" | null;
  deliveryInfo: string | null;
  // Only meaningful when status === "completed" — whether this client
  // has already left a review for it (see get_my_reviewed_booking_ids
  // in page.tsx).
  hasReview: boolean;
};

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
}: {
  upcoming: ClientBooking[];
  past: ClientBooking[];
}) {
  const t = useTranslations("Booking");
  const tReviews = useTranslations("Reviews");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  const clientTimezone = useSyncExternalStore(
    subscribeToNothing,
    getDetectedTimezone,
    getServerTimezoneSnapshot,
  ) ?? "UTC";

  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: clientTimezone,
  });

  function renderBooking(booking: ClientBooking) {
    const isActive = ACTIVE_STATUSES.has(booking.status);
    const isPastCutoff = isActive && isPastCancellationCutoff(booking.startUtc, booking.minNoticeHours);

    return (
      <li id={`booking-${booking.id}`} key={booking.id} style={{ marginBottom: "var(--space-2)" }}>
        <strong>{formatter.format(new Date(booking.startUtc))}</strong>
        {" — "}
        {t("withPractitioner", { name: booking.practitionerName })}
        {" · "}
        {booking.serviceName}
        {" · "}
        {t(STATUS_KEYS[booking.status])}
        {isActive && !isPastCutoff && (
          <>
            {" · "}
            <form
              action={cancelBookingAsClient.bind(null, booking.id, clientTimezone)}
              style={{ display: "inline" }}
              onSubmit={(e) => {
                if (!confirm(t("cancelConfirm"))) {
                  e.preventDefault();
                }
              }}
            >
              <Button type="submit" variant="secondary" size="sm">{t("cancelButton")}</Button>
            </form>
          </>
        )}
        {isActive && isPastCutoff && (
          <>
            {" · "}
            <span style={{ color: "#666", font: "var(--text-body-sm)" }}>
              {t("cancelWindowNote", { hours: booking.minNoticeHours })}
            </span>
          </>
        )}
        {isActive && booking.deliveryInfo && (
          <p style={{ margin: "var(--space-1) 0 0", backgroundColor: "#f0f4f8", padding: "var(--space-2)", borderRadius: 4 }}>
            <strong>
              {booking.deliveryType === "online" ? t("deliveryLabelOnline") : t("deliveryLabelInPerson")}:
            </strong>{" "}
            <LinkifiedText text={booking.deliveryInfo} />
          </p>
        )}
        {booking.status === "completed" &&
          (booking.hasReview ? (
            <p style={{ margin: "var(--space-1) 0 0", color: "#666", font: "var(--text-body-sm)" }}>
              {tReviews("alreadyReviewedNote")}
            </p>
          ) : (
            <LeaveReviewForm bookingId={booking.id} />
          ))}
      </li>
    );
  }

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ font: "var(--text-heading-md)" }}>{t("bookingsTitle")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "#666" }}>
        {t("timesShownIn", { timezone: clientTimezone })}
      </p>

      <h3 style={{ font: "var(--text-heading-sm)" }}>{t("upcomingHeading")}</h3>
      {upcoming.length === 0 ? (
        <p style={{ color: "#666" }}>{t("noUpcomingBookings")}</p>
      ) : (
        <ul style={{ paddingLeft: "var(--space-5)" }}>{upcoming.map(renderBooking)}</ul>
      )}

      <h3 style={{ font: "var(--text-heading-sm)" }}>{t("pastHeading")}</h3>
      {past.length === 0 ? (
        <p style={{ color: "#666" }}>{t("noPastBookings")}</p>
      ) : (
        <ul style={{ paddingLeft: "var(--space-5)" }}>{past.map(renderBooking)}</ul>
      )}
    </section>
  );
}

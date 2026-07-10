"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { cancelBookingAsClient } from "./cancel-booking-actions";
import { isPastCancellationCutoff } from "@/lib/booking-time";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

const STATUS_KEYS = {
  pending: "statusPending",
  confirmed: "statusConfirmed",
  cancelled_by_client: "statusCancelledByClient",
  cancelled_by_practitioner: "statusCancelledByPractitioner",
} as const;

const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);

// Same useSyncExternalStore pattern as SlotList.tsx / ProfileForm.tsx —
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
  status: "pending" | "confirmed" | "cancelled_by_client" | "cancelled_by_practitioner";
  // Per-booking, not per-list — a client can have bookings with
  // different practitioners on different notice settings.
  minNoticeHours: number;
};

export function BookingsList({
  upcoming,
  past,
}: {
  upcoming: ClientBooking[];
  past: ClientBooking[];
}) {
  const t = useTranslations("Booking");
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
      <li key={booking.id} style={{ marginBottom: "0.5rem" }}>
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
              action={cancelBookingAsClient.bind(null, booking.id)}
              style={{ display: "inline" }}
              onSubmit={(e) => {
                if (!confirm(t("cancelConfirm"))) {
                  e.preventDefault();
                }
              }}
            >
              <button type="submit">{t("cancelButton")}</button>
            </form>
          </>
        )}
        {isActive && isPastCutoff && (
          <>
            {" · "}
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              {t("cancelWindowNote", { hours: booking.minNoticeHours })}
            </span>
          </>
        )}
      </li>
    );
  }

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2>{t("bookingsTitle")}</h2>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {t("timesShownIn", { timezone: clientTimezone })}
      </p>

      <h3>{t("upcomingHeading")}</h3>
      {upcoming.length === 0 ? (
        <p style={{ color: "#666" }}>{t("noUpcomingBookings")}</p>
      ) : (
        <ul style={{ paddingLeft: "1.25rem" }}>{upcoming.map(renderBooking)}</ul>
      )}

      <h3>{t("pastHeading")}</h3>
      {past.length === 0 ? (
        <p style={{ color: "#666" }}>{t("noPastBookings")}</p>
      ) : (
        <ul style={{ paddingLeft: "1.25rem" }}>{past.map(renderBooking)}</ul>
      )}
    </section>
  );
}

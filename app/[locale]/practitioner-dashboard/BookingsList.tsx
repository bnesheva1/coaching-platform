import { getTranslations, getLocale } from "next-intl/server";
import { CancelBookingButton } from "./CancelBookingButton";

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

export type PractitionerBooking = {
  id: string;
  clientName: string;
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "cancelled_by_client" | "cancelled_by_practitioner";
};

// Unlike the client-dashboard's BookingsList, the practitioner's
// timezone is already known server-side (practitioner_profiles.timezone,
// fetched by the parent page) — no browser detection needed, so this
// can stay a plain server component.
export async function BookingsList({
  upcoming,
  past,
  timezone,
}: {
  upcoming: PractitionerBooking[];
  past: PractitionerBooking[];
  timezone: string;
}) {
  const t = await getTranslations("Booking");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";

  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  function renderBooking(booking: PractitionerBooking) {
    return (
      <li key={booking.id} style={{ marginBottom: "var(--space-2)" }}>
        <strong>{formatter.format(new Date(booking.startUtc))}</strong>
        {" — "}
        {t("withClient", { name: booking.clientName })}
        {" · "}
        {booking.serviceName}
        {" · "}
        {t(STATUS_KEYS[booking.status])}
        {ACTIVE_STATUSES.has(booking.status) && (
          <>
            {" · "}
            <CancelBookingButton bookingId={booking.id} />
          </>
        )}
      </li>
    );
  }

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ font: "var(--text-heading-md)" }}>{t("bookingsTitle")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "#666" }}>
        {t("timesShownIn", { timezone })}
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

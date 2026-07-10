import { getTranslations, getLocale } from "next-intl/server";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

const STATUS_KEYS = {
  pending: "statusPending",
  confirmed: "statusConfirmed",
  cancelled: "statusCancelled",
} as const;

export type PractitionerBooking = {
  id: string;
  clientName: string;
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "cancelled";
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
      <li key={booking.id} style={{ marginBottom: "0.5rem" }}>
        <strong>{formatter.format(new Date(booking.startUtc))}</strong>
        {" — "}
        {t("withClient", { name: booking.clientName })}
        {" · "}
        {booking.serviceName}
        {" · "}
        {t(STATUS_KEYS[booking.status])}
      </li>
    );
  }

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2>{t("bookingsTitle")}</h2>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {t("timesShownIn", { timezone })}
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

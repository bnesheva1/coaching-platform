import { Fragment } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { CancelSessionDialog } from "./CancelSessionDialog";
import { PastSessionsSection } from "./PastSessionsSection";
import { splitTextAndUrls } from "@/lib/linkify";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// completed is a real, reachable status (the Epic 8 auto-complete cron
// sets it once a session's end_utc passes) — omitting it here was the
// bug behind a past session rendering its status as a raw, unmapped
// "Booking" fallback instead of a translated label.
export const STATUS_KEYS = {
  pending: "statusPending",
  confirmed: "statusConfirmed",
  completed: "statusCompleted",
  cancelled_by_client: "statusCancelledByClient",
  cancelled_by_practitioner: "statusCancelledByYou",
} as const;

export const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);
export const CANCELLED_STATUSES = new Set(["cancelled_by_client", "cancelled_by_practitioner"]);

export type PractitionerBooking = {
  id: string;
  clientName: string;
  serviceName: string;
  durationMinutes: number;
  startUtc: string;
  endUtc: string;
  status: "pending" | "confirmed" | "completed" | "cancelled_by_client" | "cancelled_by_practitioner";
  deliveryType: "online" | "in_person" | null;
  deliveryInfo: string | null;
};

// Same splitTextAndUrls-based mapper as client-dashboard/BookingsList.tsx's
// own LinkifiedText — duplicated, not shared, per that module's own
// documented reasoning (it deliberately returns only the text/url split,
// not JSX, since different callers use different link components).
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

// Unlike the client-dashboard's BookingsList, the practitioner's
// timezone is already known server-side (practitioner_profiles.timezone,
// fetched by the parent page) — no browser detection needed, so this
// (and the upcoming-cards section below) can stay a plain server
// component. The past section is its own client component instead,
// since collapsing/filtering it needs local state.
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

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ font: "var(--text-heading-md)" }}>{t("bookingsTitle")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "#666" }}>{t("timesShownIn", { timezone })}</p>

      <h3 style={{ font: "var(--text-heading-sm)" }}>{t("upcomingHeading")}</h3>
      {upcoming.length === 0 ? (
        <p style={{ color: "#666" }}>{t("noUpcomingBookings")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {upcoming.map((booking) => {
            const sessionTimeLabel = formatter.format(new Date(booking.startUtc));
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
                  {t("withClient", { name: booking.clientName })}
                </p>
                <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {booking.serviceName} · {t(STATUS_KEYS[booking.status])}
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
                    <CancelSessionDialog
                      bookingId={booking.id}
                      clientName={booking.clientName}
                      sessionTimeLabel={sessionTimeLabel}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <PastSessionsSection bookings={past} timezone={timezone} />
    </section>
  );
}

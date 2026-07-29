"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  CANCELLED_STATUSES,
  COUNTERPART_LABEL_KEY,
  STATUS_KEYS,
  type BookingPerspective,
  type SessionBooking,
} from "./BookingsList";
import { LeaveReviewForm } from "./LeaveReviewForm";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

type Filter = "all" | "completed" | "cancelled";

const FILTERS: { value: Filter; labelKey: "filterAll" | "filterCompleted" | "filterCancelled" }[] = [
  { value: "all", labelKey: "filterAll" },
  { value: "completed", labelKey: "filterCompleted" },
  { value: "cancelled", labelKey: "filterCancelled" },
];

// Native <details>/<summary> for the collapse — keyboard-operable and
// announces its own expanded/collapsed state to screen readers with no
// extra aria wiring needed, unlike the custom button+max-height
// technique used for the service-tile accordion elsewhere in this app
// (that one needed a smooth height animation; this one doesn't).
export function PastSessionsSection({
  bookings,
  timezone,
  perspective,
  // The client dashboard's dedicated Past page passes true — starting
  // collapsed makes sense on a combined page where past sessions are
  // secondary to upcoming ones (the practitioner dashboard's tab, and
  // the client dashboard before its sidebar existed), but requiring an
  // extra click on a page you navigated to specifically for past
  // sessions would be pointless friction. Uncontrolled (just the
  // <details> element's own initial `open` attribute) — the user can
  // still collapse it afterward like any other <details>.
  defaultOpen = false,
}: {
  bookings: SessionBooking[];
  timezone: string;
  perspective: BookingPerspective;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Booking");
  const tReviews = useTranslations("Reviews");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const [filter, setFilter] = useState<Filter>("all");

  // Fixed at the full past list's length — must NOT shift as the filter
  // changes, per the request ("N ... should not change as filters are
  // applied"). Computed once, not derived from the filtered view below.
  const totalCount = bookings.length;

  const formatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  const filteredBookings = bookings.filter((booking) => {
    if (filter === "completed") return booking.status === "completed";
    if (filter === "cancelled") return CANCELLED_STATUSES.has(booking.status);
    return true;
  });

  const emptyMessageKey =
    filter === "completed" ? "noCompletedSessions" : filter === "cancelled" ? "noCancelledSessions" : "noPastBookings";

  const counterpartLabelKey = COUNTERPART_LABEL_KEY[perspective];
  const statusKeys = STATUS_KEYS[perspective];

  return (
    <details style={{ marginTop: "var(--space-4)" }} open={defaultOpen || undefined}>
      <summary
        style={{
          cursor: "pointer",
          font: "var(--text-heading-sm)",
          padding: "var(--space-2) 0",
        }}
      >
        {t("pastSessionsToggle", { count: totalCount })}
      </summary>

      <div style={{ marginTop: "var(--space-3)" }}>
        <div role="group" aria-label={t("filterGroupLabel")} style={{ display: "flex", gap: "var(--space-2)" }}>
          {FILTERS.map(({ value, labelKey }) => {
            const selected = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                className="focus-ring"
                onClick={() => setFilter(value)}
                style={{
                  font: "var(--text-label)",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
                  background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                  color: selected ? "var(--accent-subtle-text)" : "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {filteredBookings.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", marginTop: "var(--space-3)" }}>{t(emptyMessageKey)}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {filteredBookings.map((booking) => {
              const isCancelled = CANCELLED_STATUSES.has(booking.status);
              // Client-only: a completed session either already has a
              // review (a quiet note, matching the cancelled rows'
              // muted tone) or gets the review form inline — practitioner
              // rows never show either, there's nothing for them to do
              // with a past session.
              const showReviewSlot = perspective === "client" && booking.status === "completed";

              return (
                <li
                  key={booking.id}
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--space-3) var(--space-4)",
                    color: isCancelled ? "var(--text-tertiary)" : "var(--text-primary)",
                  }}
                >
                  <span style={{ textDecoration: isCancelled ? "line-through" : "none" }}>
                    <strong>{formatter.format(new Date(booking.startUtc))}</strong>
                    {" — "}
                    {t(counterpartLabelKey, { name: booking.counterpartName })}
                    {" · "}
                    {booking.serviceName}
                  </span>
                  {" · "}
                  {t(statusKeys[booking.status])}
                  {showReviewSlot &&
                    (booking.hasReview ? (
                      <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-tertiary)", font: "var(--text-body-sm)" }}>
                        {tReviews("alreadyReviewedNote")}
                      </p>
                    ) : (
                      <LeaveReviewForm bookingId={booking.id} />
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}

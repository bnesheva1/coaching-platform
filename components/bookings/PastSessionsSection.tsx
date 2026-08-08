"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  BookingDetailsDisclosure,
  CANCELLED_STATUSES,
  COUNTERPART_LABEL_KEY,
  STATUS_KEYS,
  type BookingPerspective,
  type SessionBooking,
} from "./BookingsList";
import { LeaveReviewForm } from "./LeaveReviewForm";
import { StarRating } from "@/components/ui/StarRating";

const INTL_LOCALES: Record<string, string> = {
  bg: "bg-BG",
  en: "en-US",
};

// Resolved video outcomes the client should see spelled out, rather than
// the generic booking status. 'manual_review' is intentionally absent — it
// isn't a client-facing outcome, so those rows fall back to "completed".
const OUTCOME_LABEL_KEY: Record<
  string,
  "outcomeBothAttended" | "outcomeClientNoShow" | "outcomePractitionerNoShow" | "outcomeNeitherAttended"
> = {
  both_attended: "outcomeBothAttended",
  client_no_show: "outcomeClientNoShow",
  practitioner_no_show: "outcomePractitionerNoShow",
  neither_attended: "outcomeNeitherAttended",
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
  // Starts collapsed everywhere — past sessions are secondary to
  // upcoming ones on both dashboards' single combined bookings screen.
  // Uncontrolled (just the <details> element's own initial `open`
  // attribute) — the user can still expand/collapse it afterward like
  // any other <details>.
  defaultOpen = false,
  id,
}: {
  bookings: SessionBooking[];
  timezone: string;
  perspective: BookingPerspective;
  defaultOpen?: boolean;
  // Anchor target for the client dashboard sidebar's "Минали" link, now
  // that Past is a section on one scrollable page rather than its own
  // route — undefined on the practitioner dashboard, which has no such
  // link.
  id?: string;
}) {
  const t = useTranslations("Booking");
  const tReviews = useTranslations("Reviews");
  const locale = useLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const [filter, setFilter] = useState<Filter>("all");
  // Which session's review form is expanded — one at a time, so the past
  // list stays a compact scannable column rather than a wall of forms.
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);

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
    <details id={id} style={{ marginTop: "var(--space-4)" }} open={defaultOpen || undefined}>
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
              // Past & not cancelled = the time has passed and it wasn't
              // called off, so it's effectively completed for display even
              // if the daily completion cron hasn't flipped the stored
              // status yet.
              const effectivelyCompleted = !isCancelled;

              // Prefer the resolved video outcome ("what actually
              // happened") over the generic booking status; fall back to
              // the (time-derived) completed/status label otherwise.
              const outcomeKey = booking.sessionOutcome ? OUTCOME_LABEL_KEY[booking.sessionOutcome] : undefined;
              const statusText = outcomeKey
                ? t(outcomeKey)
                : effectivelyCompleted
                  ? t("statusCompleted")
                  : t(statusKeys[booking.status]);

              // A review needs the booking ACTUALLY completed (the DB
              // rejects a review on any other status) and the session to
              // have taken place — no point rating a no-show.
              const reviewable =
                perspective === "client" &&
                booking.status === "completed" &&
                (!booking.sessionOutcome ||
                  booking.sessionOutcome === "both_attended" ||
                  booking.sessionOutcome === "manual_review");
              const reviewed = perspective === "client" && booking.reviewRating != null;

              const refundLabel =
                booking.refundAmountCents != null
                  ? new Intl.NumberFormat(intlLocale, {
                      style: "currency",
                      currency: booking.refundCurrency ?? booking.currency,
                    }).format(booking.refundAmountCents / 100)
                  : null;

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
                  {statusText}

                  {refundLabel && (
                    <div style={{ marginTop: "var(--space-1)" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: "var(--radius-pill)",
                          background: "var(--accent-subtle)",
                          color: "var(--accent-subtle-text)",
                          font: "var(--text-label)",
                        }}
                      >
                        {t("refundedNote", { amount: refundLabel })}
                      </span>
                    </div>
                  )}

                  <BookingDetailsDisclosure booking={booking} timezone={timezone} isPast />

                  {reviewed && (
                    <p
                      style={{
                        margin: "var(--space-1) 0 0",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        font: "var(--text-body-sm)",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {tReviews("yourRatingLabel")}
                      <span aria-label={tReviews("ratingAriaLabel", { rating: booking.reviewRating! })} style={{ color: "var(--accent)" }}>
                        <StarRating rating={booking.reviewRating!} size={15} />
                      </span>
                    </p>
                  )}

                  {reviewable &&
                    !reviewed &&
                    (openReviewId === booking.id ? (
                      <div style={{ marginTop: "var(--space-2)" }}>
                        <LeaveReviewForm bookingId={booking.id} />
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => setOpenReviewId(null)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: "var(--space-2) 0 0",
                            font: "var(--text-body-sm)",
                            color: "var(--text-tertiary)",
                            cursor: "pointer",
                          }}
                        >
                          {tReviews("rateSessionCancel")}
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginTop: "var(--space-2)" }}>
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => setOpenReviewId(booking.id)}
                          style={{
                            font: "var(--text-label)",
                            padding: "6px 14px",
                            borderRadius: "var(--radius-pill)",
                            border: "1px solid var(--border-default)",
                            background: "var(--bg-surface)",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          {tReviews("rateSessionButton")}
                        </button>
                      </div>
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

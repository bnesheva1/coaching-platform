"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import {
  createAvailabilityRule,
  deleteAvailabilityRule,
  type AvailabilityFormState,
} from "./availability-actions";

type AvailabilityRule = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

const initialState: AvailabilityFormState = null;

// Index 0 = day_of_week 1 (Monday) .. index 6 = day_of_week 7 (Sunday),
// matching the ISO 8601 convention used in the DB.
const DAY_KEYS = [
  "dayMonday",
  "dayTuesday",
  "dayWednesday",
  "dayThursday",
  "dayFriday",
  "daySaturday",
  "daySunday",
] as const;

// Services stored as HH:MM:SS (Postgres `time` default text form) — drop
// the seconds for display, both fields always have them so a plain slice
// is safe here.
function formatTime(value: string) {
  return value.slice(0, 5);
}

// Mirrors the constants/logic in availability-actions.ts's server-side
// check — duplicated deliberately, not imported: that file is a "use
// server" module, and Next.js only allows async function exports from
// those, so a plain helper can't be shared across the client/server
// boundary here. The server action re-validates everything from scratch
// regardless, and a direct API call bypassing the browser entirely still
// hits the DB-level constraints. Never treat this copy as the source of
// truth.
const MIN_DURATION_MINUTES = 15;

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Native <input type="time"> pickers don't reliably restrict their own
// UI to a `step` — browsers vary (Safari's wheel picker in particular
// just scrolls through every minute), so `step`/`min` only affect
// keyboard increments and form-submission validity, not what's
// selectable, and an invalid/required constraint failing can silently
// block the submit event before any custom onSubmit logic runs at all.
// A <select> populated with only the valid grid values makes an
// off-grid or invalid selection structurally impossible instead, in
// every browser.
//
// Every 15-minute mark in a day except the very last (23:45) — that one
// is excluded from START options specifically because no valid on-grid
// end time (start + 15min) exists for it within the same day (no
// overnight-crossing rules are supported, matching the DB constraint).
const ALL_TIME_OPTIONS = Array.from({ length: (24 * 60) / MIN_DURATION_MINUTES }, (_, i) =>
  minutesToTime(i * MIN_DURATION_MINUTES),
);
const START_TIME_OPTIONS = ALL_TIME_OPTIONS.slice(0, -1);

// Shared by every label in the "add hours" form below (and mirrored in
// AvailabilityExceptionsSection.tsx's own form) so every field's input
// starts at the same horizontal position, regardless of how long its
// own label text happens to be in the active locale — a fixed label
// column, not per-field auto-sizing.
const FIELD_LABEL_WIDTH = "7.5rem";

export function AvailabilitySection({
  rules,
  timezone,
}: {
  rules: AvailabilityRule[];
  timezone: string;
}) {
  const t = useTranslations("Availability");
  const [isAdding, setIsAdding] = useState(false);
  const [state, formAction, pending] = useActionState(createAvailabilityRule, initialState);
  // Same render-time-adjustment pattern as ServicesSection.tsx's
  // isAdding toggle — auto-collapses back to the plain list once a rule
  // is successfully added, rather than leaving the form sitting open.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success && isAdding) setIsAdding(false);
  }
  // "09:00" is a sensible default starting point (falls back to the
  // first available option in the unlikely case the grid ever changes
  // and 09:00 stops being one) — not midnight, which START_TIME_OPTIONS[0]
  // would otherwise be.
  const defaultStart = START_TIME_OPTIONS.includes("09:00") ? "09:00" : START_TIME_OPTIONS[0];
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(
    ALL_TIME_OPTIONS[ALL_TIME_OPTIONS.indexOf(defaultStart) + 1],
  );
  const [clientError, setClientError] = useState<string | null>(null);

  // Only times that are actually valid given the current start
  // selection — the dropdown itself can never offer an invalid choice,
  // so there's no "off-grid" or "before start" state to even validate
  // against once wired up this way.
  const endTimeOptions = ALL_TIME_OPTIONS.filter(
    (time) => toMinutes(time) >= toMinutes(startTime) + MIN_DURATION_MINUTES,
  );

  function handleStartChange(newStart: string) {
    setStartTime(newStart);
    setClientError(null);
    const minValidEnd = toMinutes(newStart) + MIN_DURATION_MINUTES;
    if (toMinutes(endTime) < minValidEnd) {
      setEndTime(minutesToTime(minValidEnd));
    }
  }

  // Kept as a defensive backstop, not the primary mechanism — the
  // dropdowns above already make an invalid combination unreachable
  // through the UI in normal use. Real enforcement stays server-side
  // (createAvailabilityRule) and DB-side (the sane-range/15-minute-grid
  // constraints), regardless of what this checks.
  function validateBeforeSubmit(): string | null {
    const startMinutes = toMinutes(startTime);
    const endMinutes = toMinutes(endTime);
    if (startMinutes % MIN_DURATION_MINUTES !== 0 || endMinutes % MIN_DURATION_MINUTES !== 0) {
      return t("invalidGrid", { min: MIN_DURATION_MINUTES });
    }
    if (endMinutes <= startMinutes) {
      return t("endBeforeStart");
    }
    if (endMinutes - startMinutes < MIN_DURATION_MINUTES) {
      return t("rangeTooShort", { min: MIN_DURATION_MINUTES });
    }
    return null;
  }

  // One row per calendar day, always — index 0..6 = day_of_week 1..7,
  // matching DAY_KEYS. Each day's own rules are pre-sorted by start
  // time, so multi-range days (e.g. a split morning/evening schedule)
  // display left-to-right in chronological order within their row.
  const rulesByDay: AvailabilityRule[][] = Array.from({ length: 7 }, (_, index) =>
    rules
      .filter((rule) => rule.day_of_week === index + 1)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  );

  return (
    // Flat — no card wrapper around the whole section. Each rule below
    // is its own card instead; the heading/note just sit on the page's
    // own background, same treatment as TimezoneField.tsx above it.
    <section>
      <h2 style={{ margin: 0, font: "var(--text-heading-md)" }}>{t("title")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "#666" }}>
        {t("timezoneNote", { timezone })}
      </p>

      {/* Glance-able list first — this is what a practitioner checks
          most often. All 7 days always render, empty ones included, so
          the complete weekly pattern is visible at once (not just the
          days that happen to have hours). The add-form is tucked behind
          a collapsed-by-default toggle below, not shown up front. */}
      <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {DAY_KEYS.map((dayKey, dayIndex) => {
          const dayRules = rulesByDay[dayIndex];
          const dayLabel = t(dayKey);
          return (
            <li
              key={dayKey}
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "var(--space-2)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3) var(--space-4)",
              }}
            >
              <strong style={{ flexShrink: 0 }}>{dayLabel}</strong>
              {dayRules.length === 0 ? (
                <span style={{ color: "var(--text-tertiary)" }}>{t("noHoursThisDay")}</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {dayRules.map((rule) => {
                    const range = `${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`;
                    return (
                      <span
                        key={rule.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "var(--space-1)",
                          background: "var(--bg-surface-2)",
                          borderRadius: "var(--radius-sm)",
                          padding: "2px var(--space-1) 2px var(--space-2)",
                        }}
                      >
                        {range}
                        <form
                          action={deleteAvailabilityRule.bind(null, rule.id)}
                          onSubmit={(e) => {
                            if (!confirm(t("deleteRangeConfirm", { range, day: dayLabel }))) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <button
                            type="submit"
                            aria-label={t("deleteRangeAria", { range, day: dayLabel })}
                            className="focus-ring"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              border: "none",
                              background: "transparent",
                              color: "var(--text-tertiary)",
                              font: "var(--text-caption)",
                              lineHeight: 1,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        </form>
                      </span>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!isAdding ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Button type="button" variant="secondary" onClick={() => setIsAdding(true)}>
            {t("addHoursToggle")}
          </Button>
        </div>
      ) : (
        <form
          action={formAction}
          onSubmit={(e) => {
            const error = validateBeforeSubmit();
            if (error) {
              e.preventDefault();
            }
            setClientError(error);
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-4)" }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ width: FIELD_LABEL_WIDTH, flexShrink: 0 }}>{t("dayLabel")}</span>
            <select name="dayOfWeek" defaultValue="1" required className="form-field">
              {DAY_KEYS.map((key, index) => (
                <option key={key} value={index + 1}>
                  {t(key)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ width: FIELD_LABEL_WIDTH, flexShrink: 0 }}>{t("startTimeLabel")}</span>
            <select
              name="startTime"
              required
              value={startTime}
              onChange={(e) => handleStartChange(e.target.value)}
              className="form-field"
            >
              {START_TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ width: FIELD_LABEL_WIDTH, flexShrink: 0 }}>{t("endTimeLabel")}</span>
            <select
              name="endTime"
              required
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                setClientError(null);
              }}
              className="form-field"
            >
              {endTimeOptions.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          {(clientError ?? state?.error) && (
            <p style={{ color: "crimson" }}>{clientError ?? state?.error}</p>
          )}
          {!clientError && state?.success && <p style={{ color: "green" }}>{t("addedMessage")}</p>}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit" disabled={pending}>
              {pending ? t("addButtonPending") : t("addButton")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsAdding(false)}>
              {t("cancelButton")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

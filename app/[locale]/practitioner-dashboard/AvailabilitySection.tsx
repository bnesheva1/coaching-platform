"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
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

export function AvailabilitySection({
  rules,
  timezone,
}: {
  rules: AvailabilityRule[];
  timezone: string;
}) {
  const t = useTranslations("Availability");
  const [state, formAction, pending] = useActionState(createAvailabilityRule, initialState);
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

  const sortedRules = [...rules].sort((a, b) =>
    a.day_of_week !== b.day_of_week
      ? a.day_of_week - b.day_of_week
      : a.start_time.localeCompare(b.start_time),
  );

  return (
    <section style={{ marginTop: "2rem", maxWidth: 400 }}>
      <h2>{t("title")}</h2>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>
        {t("timezoneNote", { timezone })}
      </p>

      {sortedRules.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {sortedRules.map((rule) => (
            <li key={rule.id} style={{ marginBottom: "0.5rem" }}>
              <strong>{t(DAY_KEYS[rule.day_of_week - 1])}</strong>{" "}
              {formatTime(rule.start_time)}–{formatTime(rule.end_time)}{" "}
              <form
                action={deleteAvailabilityRule.bind(null, rule.id)}
                style={{ display: "inline" }}
                onSubmit={(e) => {
                  if (!confirm(t("deleteConfirm"))) {
                    e.preventDefault();
                  }
                }}
              >
                <button type="submit">{t("deleteButton")}</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: "#666" }}>{t("noRulesYet")}</p>
      )}

      <form
        action={formAction}
        onSubmit={(e) => {
          const error = validateBeforeSubmit();
          if (error) {
            e.preventDefault();
          }
          setClientError(error);
        }}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}
      >
        <label>
          {t("dayLabel")}
          <select name="dayOfWeek" defaultValue="1" required>
            {DAY_KEYS.map((key, index) => (
              <option key={key} value={index + 1}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("startTimeLabel")}
          <select
            name="startTime"
            required
            value={startTime}
            onChange={(e) => handleStartChange(e.target.value)}
          >
            {START_TIME_OPTIONS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("endTimeLabel")}
          <select
            name="endTime"
            required
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              setClientError(null);
            }}
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
        <button type="submit" disabled={pending}>
          {pending ? t("addButtonPending") : t("addButton")}
        </button>
      </form>
    </section>
  );
}

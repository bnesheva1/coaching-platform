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

export function AvailabilitySection({
  rules,
  timezone,
}: {
  rules: AvailabilityRule[];
  timezone: string;
}) {
  const t = useTranslations("Availability");
  const [state, formAction, pending] = useActionState(createAvailabilityRule, initialState);
  // Drives the end-time input's `min` so the browser itself refuses an
  // end time at or before the chosen start — a UX nudge only, the real
  // enforcement is server-side (createAvailabilityRule) and DB-side
  // (practitioner_availability_sane_range / the 15-minute grid check).
  const [startTime, setStartTime] = useState("");

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
          <input
            name="startTime"
            type="time"
            step={900}
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label>
          {t("endTimeLabel")}
          <input name="endTime" type="time" step={900} min={startTime || undefined} required />
        </label>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        {state?.success && <p style={{ color: "green" }}>{t("addedMessage")}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t("addButtonPending") : t("addButton")}
        </button>
      </form>
    </section>
  );
}

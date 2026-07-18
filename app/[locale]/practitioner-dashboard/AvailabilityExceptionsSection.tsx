"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import {
  createAvailabilityException,
  deleteAvailabilityException,
  type AvailabilityExceptionFormState,
} from "./availability-exceptions-actions";

type AvailabilityException = {
  id: string;
  exception_date: string; // "YYYY-MM-DD"
  start_time: string | null; // "HH:MM:SS", null for a whole-date block
  end_time: string | null;
};

const initialState: AvailabilityExceptionFormState = null;

// exception_date has no time-of-day meaning, so it's parsed and
// formatted entirely in UTC — anchoring both ends to the same zone is
// what avoids the classic off-by-one-day bug from letting the runtime
// apply the browser's local zone to a bare date string.
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

// Stored as HH:MM:SS (Postgres `time` default text form) — drop the
// seconds for display, same convention as AvailabilitySection.tsx's
// formatTime.
function formatTime(value: string) {
  return value.slice(0, 5);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Mirrors AvailabilitySection.tsx's own grid-construction constants
// verbatim — duplicated rather than shared, same established precedent
// (client/server boundary aside, it's a handful of lines). Native
// <input type="time"> pickers don't reliably restrict their own UI to a
// step (this project already hit and fixed that exact reliability
// problem once) — a <select> populated with only valid grid values
// makes an off-grid selection structurally impossible instead.
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

const ALL_TIME_OPTIONS = Array.from({ length: (24 * 60) / MIN_DURATION_MINUTES }, (_, i) =>
  minutesToTime(i * MIN_DURATION_MINUTES),
);
const START_TIME_OPTIONS = ALL_TIME_OPTIONS.slice(0, -1);

export function AvailabilityExceptionsSection({
  exceptions,
}: {
  exceptions: AvailabilityException[];
}) {
  const t = useTranslations("AvailabilityExceptions");
  const tAvailability = useTranslations("Availability");
  const [state, formAction, pending] = useActionState(createAvailabilityException, initialState);
  const [blockType, setBlockType] = useState<"wholeDay" | "timeRange">("wholeDay");
  const defaultStart = START_TIME_OPTIONS.includes("09:00") ? "09:00" : START_TIME_OPTIONS[0];
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(
    ALL_TIME_OPTIONS[ALL_TIME_OPTIONS.indexOf(defaultStart) + 1],
  );

  const endTimeOptions = ALL_TIME_OPTIONS.filter(
    (time) => toMinutes(time) >= toMinutes(startTime) + MIN_DURATION_MINUTES,
  );

  function handleStartChange(newStart: string) {
    setStartTime(newStart);
    const minValidEnd = toMinutes(newStart) + MIN_DURATION_MINUTES;
    if (toMinutes(endTime) < minValidEnd) {
      setEndTime(minutesToTime(minValidEnd));
    }
  }

  const sortedExceptions = [...exceptions].sort((a, b) =>
    a.exception_date === b.exception_date
      ? (a.start_time ?? "").localeCompare(b.start_time ?? "")
      : a.exception_date.localeCompare(b.exception_date),
  );

  return (
    <section style={{ marginTop: "var(--space-8)" }}>
      <h2 style={{ font: "var(--text-heading-md)" }}>{t("title")}</h2>

      {sortedExceptions.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {sortedExceptions.map((exception) => {
            const label =
              exception.start_time && exception.end_time
                ? `${formatDate(exception.exception_date)}, ${formatTime(exception.start_time)}–${formatTime(exception.end_time)}`
                : formatDate(exception.exception_date);
            return (
              <li key={exception.id} style={{ marginBottom: "var(--space-2)" }}>
                {label}{" "}
                <form
                  action={deleteAvailabilityException.bind(null, exception.id)}
                  style={{ display: "inline" }}
                  onSubmit={(e) => {
                    if (!confirm(t("deleteConfirm", { date: label }))) {
                      e.preventDefault();
                    }
                  }}
                >
                  <Button type="submit" variant="secondary" size="sm">{t("deleteButton")}</Button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={{ color: "#666" }}>{t("noExceptionsYet")}</p>
      )}

      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-4)" }}
      >
        <label>
          {t("dateLabel")}
          <input type="date" name="exceptionDate" min={todayIsoDate()} required className="form-field" />
        </label>

        <fieldset style={{ border: "none", padding: 0 }}>
          <legend style={{ padding: 0 }}>{t("blockTypeLegend")}</legend>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="blockType"
              checked={blockType === "wholeDay"}
              onChange={() => setBlockType("wholeDay")}
            />{" "}
            {t("wholeDayOption")}
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="blockType"
              checked={blockType === "timeRange"}
              onChange={() => setBlockType("timeRange")}
            />{" "}
            {t("timeRangeOption")}
          </label>
        </fieldset>

        {blockType === "timeRange" && (
          <>
            <label>
              {tAvailability("startTimeLabel")}
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
            <label>
              {tAvailability("endTimeLabel")}
              <select name="endTime" required value={endTime} onChange={(e) => setEndTime(e.target.value)} className="form-field">
                {endTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        {state?.success && (
          <>
            <p style={{ color: "green" }}>{t("addedMessage")}</p>
            {!!state.warningCount && state.warningCount > 0 && (
              <p style={{ color: "#a15c00" }}>
                {t("existingBookingsWarning", { count: state.warningCount })}
              </p>
            )}
          </>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("addButtonPending") : t("addButton")}
        </Button>
      </form>
    </section>
  );
}

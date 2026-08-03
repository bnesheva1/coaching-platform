"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";
import { EditPencilButton } from "@/components/practitioner-profile/EditPencilButton";
import {
  applyRangesToDays,
  applyAvailabilityPreset,
  type TimeRange,
  type AvailabilityPresetKey,
} from "./availability-actions";
import styles from "./AvailabilitySection.module.css";

type AvailabilityRule = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

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

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function isWeekendDay(day: number): boolean {
  return WEEKEND.includes(day);
}

const PRESET_ORDER: AvailabilityPresetKey[] = ["weekdayEvenings", "weekends", "weekdayDaytime"];

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
// UI to a `step` — a <select> populated with only the valid grid values
// makes an off-grid or invalid selection structurally impossible
// instead, in every browser. See availability-actions.ts's identical
// note.
const ALL_TIME_OPTIONS = Array.from({ length: (24 * 60) / MIN_DURATION_MINUTES }, (_, i) =>
  minutesToTime(i * MIN_DURATION_MINUTES),
);
const START_TIME_OPTIONS = ALL_TIME_OPTIONS.slice(0, -1);
const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "17:00" };

// Reasonable next range once a day already has at least one — starts
// right where the last one ends (if that's still a valid start on the
// grid) with a 1-hour default span, clamped to the last possible slot.
// Just a starting point either way; every field stays fully editable
// before Save.
function nextDefaultRange(existing: TimeRange[]): TimeRange {
  if (existing.length === 0) return DEFAULT_RANGE;
  const lastEnd = existing[existing.length - 1].end;
  if (!START_TIME_OPTIONS.includes(lastEnd)) return DEFAULT_RANGE;
  const endMinutes = Math.min(toMinutes(lastEnd) + 60, toMinutes(ALL_TIME_OPTIONS[ALL_TIME_OPTIONS.length - 1]));
  return { start: lastEnd, end: minutesToTime(endMinutes) };
}

function endOptionsFor(start: string): string[] {
  return ALL_TIME_OPTIONS.filter((time) => toMinutes(time) >= toMinutes(start) + MIN_DURATION_MINUTES);
}

type ApplyScope = "weekdays" | "weekend" | "allDays";

function targetsForScope(scope: ApplyScope): number[] {
  return scope === "weekdays" ? WEEKDAYS : scope === "weekend" ? WEEKEND : ALL_DAYS;
}

export function AvailabilitySection({
  rules,
  timezone,
  exceptionsCount,
  upcomingBookingsCount,
}: {
  rules: AvailabilityRule[];
  timezone: string;
  exceptionsCount: number;
  upcomingBookingsCount: number;
}) {
  const t = useTranslations("Availability");
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editRanges, setEditRanges] = useState<TimeRange[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  // One row per calendar day, always — index 0..6 = day_of_week 1..7,
  // matching DAY_KEYS. Each day's own rules are pre-sorted by start
  // time, so multi-range days (e.g. a split morning/evening schedule)
  // display left-to-right in chronological order within their row.
  const rulesByDay: AvailabilityRule[][] = Array.from({ length: 7 }, (_, index) =>
    rules
      .filter((rule) => rule.day_of_week === index + 1)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  );
  const isWeekEmpty = rulesByDay.every((day) => day.length === 0);

  // "Apply to weekdays" / "Apply to all days" live inside the edit
  // modal now, not the collapsed row — they act on whatever's currently
  // in the edit form (editRanges), not a stale saved copy of this day.
  // Always confirmed, unconditionally: this touches a chunk of the
  // whole week at once, which is exactly the kind of action worth a
  // deliberate second click regardless of what the target days already
  // had.
  const [pendingApply, setPendingApply] = useState<ApplyScope | null>(null);
  const applyDialogRef = useRef<ConfirmDialogHandle>(null);

  async function toResult(action: () => Promise<{ error: string } | { success: true }>) {
    setActionError(null);
    const result = await action();
    if ("error" in result) setActionError(result.error);
    return result;
  }

  function handlePreset(preset: AvailabilityPresetKey) {
    startTransition(async () => {
      await toResult(() => applyAvailabilityPreset(preset));
    });
  }

  function openEdit(day: number) {
    const existing = rulesByDay[day - 1];
    setEditingDay(day);
    setEditError(null);
    setEditRanges(
      existing.length > 0 ? existing.map((r) => ({ start: formatTime(r.start_time), end: formatTime(r.end_time) })) : [DEFAULT_RANGE],
    );
  }

  function closeEdit() {
    setEditingDay(null);
    setEditError(null);
    setPendingApply(null);
  }

  function validateRanges(ranges: TimeRange[]): string | null {
    for (const r of ranges) {
      if (toMinutes(r.end) - toMinutes(r.start) < MIN_DURATION_MINUTES) {
        return t("rangeTooShort", { min: MIN_DURATION_MINUTES });
      }
    }
    return null;
  }

  function handleSaveDay() {
    if (editingDay === null) return;
    const error = validateRanges(editRanges);
    if (error) {
      setEditError(error);
      return;
    }
    startTransition(async () => {
      setEditError(null);
      const result = await applyRangesToDays(editRanges, [editingDay]);
      if ("error" in result) {
        setEditError(result.error);
        return;
      }
      closeEdit();
    });
  }

  function handleApplyScopeClick(scope: ApplyScope) {
    const error = validateRanges(editRanges);
    if (error) {
      setEditError(error);
      return;
    }
    setEditError(null);
    setPendingApply(scope);
    applyDialogRef.current?.open();
  }

  const presetButtons = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      {PRESET_ORDER.map((key) => (
        <Button
          key={key}
          type="button"
          variant={isWeekEmpty ? "primary" : "secondary"}
          size={isWeekEmpty ? "md" : "sm"}
          disabled={isPending}
          onClick={() => handlePreset(key)}
        >
          {t(`preset.${key}`)}
        </Button>
      ))}
    </div>
  );

  return (
    // Flat — no card wrapper around the whole section. Each rule below
    // is its own card instead; the heading/note just sit on the page's
    // own background, same treatment as TimezoneField.tsx above it.
    <section>
      <h2 style={{ margin: 0, font: "var(--text-heading-md)" }}>{t("title")}</h2>
      <p style={{ font: "var(--text-body-sm)", color: "#666" }}>{t("timezoneNote", { timezone })}</p>

      {/* Prominent, its own callout, when the week has nothing set yet
          — a first-run aid, not something worth repeating once the week
          is actually configured. Hidden entirely (not just shrunk to a
          quiet row) once any day has hours; reappears the moment the
          week goes back to fully empty. */}
      {isWeekEmpty && (
        <div
          style={{
            marginTop: "var(--space-4)",
            padding: "var(--space-4)",
            borderRadius: "var(--radius-lg)",
            background: "var(--accent-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--accent-subtle-text)" }}>{t("preset.emptyPrompt")}</p>
          {presetButtons}
        </div>
      )}

      {/* Glance-able list — all 7 days always render, empty ones
          included, so the complete weekly pattern is visible at once. */}
      <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {DAY_KEYS.map((dayKey, dayIndex) => {
          const day = dayIndex + 1;
          const dayRules = rulesByDay[dayIndex];
          const label = t(dayKey);
          const isEditing = editingDay === day;

          if (isEditing) {
            return (
              <li
                key={dayKey}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3) var(--space-4)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                <strong>{label}</strong>
                {editRanges.map((range, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <select
                      aria-label={t("startTimeLabel")}
                      value={range.start}
                      className="form-field"
                      onChange={(e) => {
                        const newStart = e.target.value;
                        setEditRanges((prev) =>
                          prev.map((r, idx) =>
                            idx === i
                              ? {
                                  start: newStart,
                                  end: toMinutes(r.end) < toMinutes(newStart) + MIN_DURATION_MINUTES ? minutesToTime(toMinutes(newStart) + MIN_DURATION_MINUTES) : r.end,
                                }
                              : r,
                          ),
                        );
                        setEditError(null);
                      }}
                    >
                      {START_TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden style={{ color: "var(--text-tertiary)" }}>
                      –
                    </span>
                    <select
                      aria-label={t("endTimeLabel")}
                      value={range.end}
                      className="form-field"
                      onChange={(e) => {
                        const newEnd = e.target.value;
                        setEditRanges((prev) => prev.map((r, idx) => (idx === i ? { ...r, end: newEnd } : r)));
                        setEditError(null);
                      }}
                    >
                      {endOptionsFor(range.start).map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={t("removeRangeAria", { range: `${range.start}–${range.end}`, day: label })}
                      className="focus-ring"
                      onClick={() => setEditRanges((prev) => prev.filter((_, idx) => idx !== i))}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-tertiary)",
                        font: "var(--text-body-md)",
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditRanges((prev) => [...prev, nextDefaultRange(prev)])}>
                    {t("addRangeButton")}
                  </Button>
                </div>

                {/* Copy actions live here, inside the edit form — they
                    apply exactly what's currently in this form (saving
                    this day as a side effect), not a previously-saved
                    copy of it. Shown regardless of whether editRanges is
                    empty (clearing this day AND applying that clear
                    elsewhere is a coherent, if less common, use of the
                    same action). The first button's scope/label flips
                    to "weekend" on Saturday/Sunday — "apply to weekdays"
                    isn't a useful primary action from a weekend row;
                    matching the other weekend day is. */}
                {/* variant="secondary" (bordered, like "Add a blocked
                    date"), not "ghost" — these read as actions, not
                    labels, and are the most useful thing on this
                    screen. Still visually lighter than Save's primary
                    fill, and one step up from Cancel's plain ghost text,
                    keeping the hierarchy Save > apply actions > Cancel. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleApplyScopeClick(isWeekendDay(day) ? "weekend" : "weekdays")}
                  >
                    {t(isWeekendDay(day) ? "applyToWeekendButton" : "applyToWeekdaysButton")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={() => handleApplyScopeClick("allDays")}>
                    {t("applyToAllDaysButton")}
                  </Button>
                </div>

                {editError && <p style={{ margin: 0, color: "crimson" }}>{editError}</p>}
                {/* Extra breathing room above (space-4, not the space-2
                    the rest of this form uses between rows) so Save/
                    Cancel read as a distinct, final row rather than
                    crowding straight up against the apply actions above
                    them. Right-aligned on desktop (the row's primary
                    controls, at the natural end of the reading flow),
                    full-width/left on mobile — see the CSS module for
                    why this one property can't be an inline style. */}
                <div className={styles.saveCancelRow} style={{ marginTop: "var(--space-4)" }}>
                  <Button type="button" size="sm" disabled={isPending} onClick={handleSaveDay}>
                    {isPending ? t("dayEditSaveButtonPending") : t("dayEditSaveButton")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={closeEdit}>
                    {t("dayEditCancelButton")}
                  </Button>
                </div>
              </li>
            );
          }

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
              <strong style={{ flexShrink: 0 }}>{label}</strong>
              {dayRules.length === 0 ? (
                <span style={{ color: "var(--text-tertiary)" }}>{t("noHoursThisDay")}</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {dayRules.map((rule) => (
                    <span
                      key={rule.id}
                      style={{
                        background: "var(--bg-surface-2)",
                        borderRadius: "var(--radius-sm)",
                        padding: "2px var(--space-2)",
                      }}
                    >
                      {formatTime(rule.start_time)}–{formatTime(rule.end_time)}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ marginLeft: "auto" }}>
                <EditPencilButton label={t("editDayAria", { day: label })} onClick={() => openEdit(day)} />
              </div>
            </li>
          );
        })}
      </ul>

      {actionError && (
        <p style={{ marginTop: "var(--space-3)", color: "crimson" }}>{actionError}</p>
      )}

      <ConfirmDialog
        ref={applyDialogRef}
        title={
          pendingApply
            ? t(
                pendingApply === "weekdays"
                  ? "overwriteConfirmTitleWeekdays"
                  : pendingApply === "weekend"
                    ? "overwriteConfirmTitleWeekend"
                    : "overwriteConfirmTitleAllDays",
              )
            : undefined
        }
        message={t("overwriteConfirmMessage", { count: upcomingBookingsCount })}
        confirmLabel={t("overwriteConfirmConfirm")}
        cancelLabel={t("overwriteConfirmDismiss")}
        action={async () => {
          if (editingDay === null || !pendingApply) return;
          const days = [...new Set([editingDay, ...targetsForScope(pendingApply)])];
          const result = await toResult(() => applyRangesToDays(editRanges, days));
          setPendingApply(null);
          if (!("error" in result)) closeEdit();
        }}
        onCancel={() => setPendingApply(null)}
      />

      {/* Connects the two halves of "when am I available" — blocked
          dates live in their own section below, not duplicated here.
          Only shown when there's actually something to point at — at
          zero, AvailabilityExceptionsSection's own "You haven't blocked
          any dates" already covers it, right below. */}
      {exceptionsCount > 0 && (
        <p style={{ marginTop: "var(--space-4)" }}>
          <a href="#blocked-dates" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            {t("blockedDatesCount", { count: exceptionsCount })}
          </a>
        </p>
      )}
    </section>
  );
}

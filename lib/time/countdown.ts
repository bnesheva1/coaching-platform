// Pure countdown formatting — no React, no I/O, no "@/" imports — so it's
// the single source of truth shared by every countdown surface (the
// in-session end warning, the waiting room, and the dashboard next-session
// card) and is directly unit-testable with plain node.

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Clock style (H:MM:SS or M:SS) for the second-granularity session
// countdowns. Ceil, so it reads 0:01 right up until the instant is truly
// reached rather than blinking to 0:00 a second early.
export function formatClock(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / SECOND));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type CountdownUnit = "day" | "hour" | "minute";
export type RelativePart = { unit: CountdownUnit; value: number };

// Units-and-plurals style for the minute-granularity dashboard countdown.
// Granularity (per spec): >1 day -> days+hours; under a day -> hours+
// minutes; under an hour -> minutes only. A trailing zero unit is dropped
// (e.g. exactly two days reads "2 дни", not "2 дни 0 ч"). Never returns an
// empty list or a zero-minute part — the caller only renders this outside
// the join window, where at least a few minutes always remain.
export function relativeParts(msLeft: number): RelativePart[] {
  const clamped = Math.max(0, msLeft);
  const days = Math.floor(clamped / DAY);
  const hours = Math.floor((clamped % DAY) / HOUR);
  const minutes = Math.floor((clamped % HOUR) / MINUTE);

  if (days >= 1) {
    const parts: RelativePart[] = [{ unit: "day", value: days }];
    if (hours > 0) parts.push({ unit: "hour", value: hours });
    return parts;
  }
  if (hours >= 1) {
    const parts: RelativePart[] = [{ unit: "hour", value: hours }];
    if (minutes > 0) parts.push({ unit: "minute", value: minutes });
    return parts;
  }
  return [{ unit: "minute", value: Math.max(1, minutes) }];
}

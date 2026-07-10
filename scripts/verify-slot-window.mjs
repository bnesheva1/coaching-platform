// Proves the slot-generation horizon is a rolling BOOKING_WINDOW_DAYS
// (30) window from today, in the practitioner's own calendar — not
// bounded to the current calendar month (there never was any
// month-aware code path; this just confirms the exported constant and
// the actual generated span agree, since that's the one thing that
// could now silently drift out of sync if the two were ever
// duplicated again).
//
// Run: node scripts/verify-slot-window.mjs (no DB/env needed — pure
// computation test).

import { DateTime } from "luxon";
import { generateSlots, BOOKING_WINDOW_DAYS } from "../lib/availability/generateSlots.ts";

const ZONE = "Europe/Sofia";
const now = DateTime.utc();

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

console.log(`=== BOOKING_WINDOW_DAYS is exported as ${BOOKING_WINDOW_DAYS} ===\n`);
check("the exported constant is 30", BOOKING_WINDOW_DAYS === 30);

console.log("\n=== The DEFAULT window (no explicit windowDays override) spans exactly 30 distinct dates ===\n");

// Spans nearly the whole day, not a narrow window — a narrow rule (e.g.
// "09:00-09:15") can already be in the past by the time this script
// happens to run, depending on the current wall-clock time in the
// practitioner's zone, which would wrongly make "today" produce zero
// slots and fail the count below for reasons unrelated to the window
// size itself. Same robustness reasoning already used in
// verify-slot-min-notice.mjs and verify-slot-partial-block.mjs.
const everyDayRule = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
  day_of_week,
  start_time: "00:00:00",
  end_time: "23:45:00",
}));

// No windowDays passed at all — this exercises the real default,
// unlike every other verify-slot-*.mjs script, which all pass an
// explicit override and would never have caught a drift here.
const slots = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 15,
  now,
});

const distinctDates = new Set(
  slots.map((s) => DateTime.fromISO(s.startUtc, { zone: "utc" }).setZone(ZONE).toISODate()),
);
check(`exactly ${BOOKING_WINDOW_DAYS} distinct dates are produced by default`, distinctDates.size === BOOKING_WINDOW_DAYS);

const todayLocal = now.setZone(ZONE).toISODate();
const expectedLastDate = now.setZone(ZONE).startOf("day").plus({ days: BOOKING_WINDOW_DAYS - 1 }).toISODate();
check(`the earliest date is today (${todayLocal}) in the practitioner's zone`, [...distinctDates].sort()[0] === todayLocal);
check(
  `the latest date is exactly today + ${BOOKING_WINDOW_DAYS - 1} days (${expectedLastDate}), not today + ${BOOKING_WINDOW_DAYS}`,
  [...distinctDates].sort().at(-1) === expectedLastDate,
);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — 30-day rolling window verified correct" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

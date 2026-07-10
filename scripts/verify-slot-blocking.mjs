// Proves the actual coupling between availability exceptions and slot
// generation: a blocked date produces ZERO slots, for any rule, any
// duration, while adjacent (unblocked) dates are untouched. This is
// the crux of Epic 5 slice 3 — not just that blockedDates is accepted
// as a parameter, but that it actually zeroes out the right day and
// no other, using the exact same day-loop the DST test exercises.
//
// Run: node scripts/verify-slot-blocking.mjs (no DB/env needed — pure
// computation test).

import { DateTime } from "luxon";
import { generateSlots } from "../lib/availability/generateSlots.ts";

const ZONE = "Europe/Sofia";
const now = DateTime.utc();

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

// A rule covering every day of the week, so any missing slots can only
// be explained by the blocking logic, never by "no rule matched anyway".
const everyDayRule = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
  day_of_week,
  start_time: "09:00:00",
  end_time: "17:00:00",
}));

const windowDays = 10;
const startOfWindow = now.setZone(ZONE).startOf("day");
// A date comfortably inside the window, in the practitioner's own
// calendar — this is deliberately the same "date.toISODate()" shape
// generateSlots itself produces, not a UTC-derived string, since that's
// the exact value blockedDates is compared against.
const blockedDate = startOfWindow.plus({ days: 4 }).toISODate();

console.log(`=== Blocking ${blockedDate} (day 4 of a ${windowDays}-day window) ===\n`);

const unblockedSlots = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 30,
  windowDays,
  now,
});
const blockedSlots = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 30,
  blockedDates: [blockedDate],
  windowDays,
  now,
});

const unblockedOnTargetDate = unblockedSlots.filter(
  (s) => DateTime.fromISO(s.startUtc, { zone: "utc" }).setZone(ZONE).toISODate() === blockedDate,
);
check(
  "without blocking, the target date genuinely has slots (sanity check the test itself)",
  unblockedOnTargetDate.length > 0,
);

const blockedOnTargetDate = blockedSlots.filter(
  (s) => DateTime.fromISO(s.startUtc, { zone: "utc" }).setZone(ZONE).toISODate() === blockedDate,
);
check("the blocked date produces ZERO slots once blockedDates includes it", blockedOnTargetDate.length === 0);

const otherDatesUnblocked = unblockedSlots.filter(
  (s) => DateTime.fromISO(s.startUtc, { zone: "utc" }).setZone(ZONE).toISODate() !== blockedDate,
).length;
const otherDatesBlocked = blockedSlots.filter(
  (s) => DateTime.fromISO(s.startUtc, { zone: "utc" }).setZone(ZONE).toISODate() !== blockedDate,
).length;
check(
  "every OTHER date in the window is completely unaffected (same slot count with and without the block)",
  otherDatesUnblocked === otherDatesBlocked && otherDatesUnblocked > 0,
);

check(
  "total slot count dropped by exactly the target date's own slot count, nothing more/less",
  blockedSlots.length === unblockedSlots.length - unblockedOnTargetDate.length,
);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — blocked-date subtraction verified correct" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

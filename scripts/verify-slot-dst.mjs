// Proves per-occurrence DST resolution actually works — not just that
// generateSlots runs without error, which would look fine most of the
// year even with a naive fixed-offset bug. Finds the *real* next DST
// transition for a test zone (doesn't hardcode a calendar date that
// could be wrong or go stale) by scanning UTC-offset changes, then
// asserts the SAME recurring local-time rule resolves to a DIFFERENT
// UTC instant on either side of that transition.
//
// Run: node scripts/verify-slot-dst.mjs (no DB/env needed — pure
// computation test).

import { DateTime } from "luxon";
import { generateSlots } from "../lib/availability/generateSlots.ts";

const ZONE = "Europe/Sofia";
const now = DateTime.utc();

function findNextTransition(zone, from, maxDays) {
  let prevOffset = from.setZone(zone).offset;
  for (let i = 1; i <= maxDays; i++) {
    const day = from.plus({ days: i }).setZone(zone);
    if (day.offset !== prevOffset) {
      return { daysFromNow: i, offsetBefore: prevOffset, offsetAfter: day.offset };
    }
    prevOffset = day.offset;
  }
  return null;
}

const transition = findNextTransition(ZONE, now, 240);
let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

if (!transition) {
  console.error("No DST transition found for", ZONE, "within 240 days — cannot verify. FAIL.");
  process.exit(1);
}

console.log(
  `Next ${ZONE} DST transition: ~${transition.daysFromNow} days from now ` +
    `(UTC offset ${transition.offsetBefore / 60}h -> ${transition.offsetAfter / 60}h)\n`,
);

// A day comfortably before and after the transition, both a safe margin
// from the boundary itself to avoid the (separate, rarer) ambiguous/
// nonexistent-local-time edge hours right at the transition.
const beforeDate = now.plus({ days: transition.daysFromNow - 3 }).setZone(ZONE).startOf("day");
const afterDate = now.plus({ days: transition.daysFromNow + 3 }).setZone(ZONE).startOf("day");

function resolvedUtcHourFor(date) {
  // Period exactly matches the service duration (15min) so there's
  // exactly one valid candidate (14:00) — unambiguous for this test.
  const rule = { day_of_week: date.weekday, start_time: "14:00:00", end_time: "14:15:00" };
  const slots = generateSlots({
    rules: [rule],
    timezone: ZONE,
    serviceDurationMinutes: 15,
    windowDays: 1,
    now: date,
  });
  check(`exactly one slot generated for ${date.toISODate()}`, slots.length === 1);
  return DateTime.fromISO(slots[0].startUtc, { zone: "utc" }).hour;
}

console.log("=== The core proof: same local rule (14:00 Sofia), different sides of the DST transition ===");
const beforeUtcHour = resolvedUtcHourFor(beforeDate);
const afterUtcHour = resolvedUtcHourFor(afterDate);
console.log(`  ${beforeDate.toISODate()} (before transition): 14:00 Sofia -> ${beforeUtcHour}:00 UTC`);
console.log(`  ${afterDate.toISODate()}  (after transition):  14:00 Sofia -> ${afterUtcHour}:00 UTC`);
check(
  "the SAME local rule resolves to a DIFFERENT UTC hour across the DST boundary (proves per-occurrence resolution, not a fixed offset)",
  beforeUtcHour !== afterUtcHour,
);

console.log("\n=== Negative control: two dates on the SAME side of the transition must resolve identically ===");
const beforeDate2 = beforeDate.minus({ days: 7 });
const beforeUtcHour2 = resolvedUtcHourFor(beforeDate2);
check(
  "two dates both before the transition resolve to the SAME UTC hour (rules out a bug that varies unpredictably)",
  beforeUtcHour === beforeUtcHour2,
);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — DST-per-occurrence resolution verified correct" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

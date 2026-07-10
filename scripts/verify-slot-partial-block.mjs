// Proves partial-day (time-range) blocking actually works: a slot
// overlapping the blocked range is excluded, slots on the same date
// but outside the range are still offered, a whole-date block on a
// different date is completely unaffected (regression), and — the
// actual DST-safety proof — the same local time range resolves to
// different-but-correct UTC exclusion windows on either side of a real
// DST transition, using the same transition-finding technique as
// verify-slot-dst.mjs.
//
// Run: node scripts/verify-slot-partial-block.mjs (no DB/env needed —
// pure computation test).

import { DateTime } from "luxon";
import { generateSlots } from "../lib/availability/generateSlots.ts";

const ZONE = "Europe/Sofia";
const now = DateTime.utc();

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures++;
}

const allDayRule = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
  day_of_week,
  start_time: "09:00:00",
  end_time: "18:00:00",
}));

console.log("=== A partial-day block excludes only slots overlapping its range ===\n");

const windowDays = 5;
const targetDate = now.setZone(ZONE).startOf("day").plus({ days: 2 }).toISODate();
const otherWholeDateBlocked = now.setZone(ZONE).startOf("day").plus({ days: 4 }).toISODate();

const slots = generateSlots({
  rules: allDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 30,
  blockedDates: [otherWholeDateBlocked], // regression: whole-date blocking alongside partial
  blockedRanges: [{ date: targetDate, startTime: "14:00:00", endTime: "16:00:00" }],
  windowDays,
  now,
});

function localDateOf(slot) {
  return DateTime.fromISO(slot.startUtc, { zone: "utc" }).setZone(ZONE).toISODate();
}
function localTimeOf(slot) {
  return DateTime.fromISO(slot.startUtc, { zone: "utc" }).setZone(ZONE).toFormat("HH:mm");
}

const onTargetDate = slots.filter((s) => localDateOf(s) === targetDate);
check("the target date still has slots outside the blocked range", onTargetDate.length > 0);
check(
  "no slot on the target date starts inside [14:00, 16:00)",
  onTargetDate.every((s) => localTimeOf(s) < "14:00" || localTimeOf(s) >= "16:00"),
);
check(
  "slots immediately before 14:00 and from 16:00 onward on the target date ARE still offered",
  onTargetDate.some((s) => localTimeOf(s) === "13:30") && onTargetDate.some((s) => localTimeOf(s) === "16:00"),
);
check(
  "the whole-date-blocked date (different date, same call) still has zero slots — regression",
  slots.filter((s) => localDateOf(s) === otherWholeDateBlocked).length === 0,
);

console.log("\n=== DST safety: the same local range resolves correctly on either side of a real transition ===\n");

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
if (!transition) {
  console.error("No DST transition found for", ZONE, "within 240 days — cannot verify. FAIL.");
  process.exit(1);
}

const beforeDate = now.plus({ days: transition.daysFromNow - 3 }).setZone(ZONE).startOf("day");
const afterDate = now.plus({ days: transition.daysFromNow + 3 }).setZone(ZONE).startOf("day");

function slotAt1400ExcludedByBlock(date) {
  // A period exactly matching the blocked range so there's exactly one
  // candidate (14:00) to reason about — unambiguous.
  const rule = { day_of_week: date.weekday, start_time: "14:00:00", end_time: "14:30:00" };
  const withoutBlock = generateSlots({
    rules: [rule],
    timezone: ZONE,
    serviceDurationMinutes: 30,
    windowDays: 1,
    now: date,
  });
  const withBlock = generateSlots({
    rules: [rule],
    timezone: ZONE,
    serviceDurationMinutes: 30,
    blockedRanges: [{ date: date.toISODate(), startTime: "14:00:00", endTime: "14:30:00" }],
    windowDays: 1,
    now: date,
  });
  return { withoutBlock: withoutBlock.length, withBlock: withBlock.length };
}

const beforeResult = slotAt1400ExcludedByBlock(beforeDate);
const afterResult = slotAt1400ExcludedByBlock(afterDate);

check(
  `before the transition (${beforeDate.toISODate()}): the 14:00 slot exists without the block and is excluded with it`,
  beforeResult.withoutBlock === 1 && beforeResult.withBlock === 0,
);
check(
  `after the transition (${afterDate.toISODate()}): the same local range still correctly excludes the 14:00 slot post-DST-shift`,
  afterResult.withoutBlock === 1 && afterResult.withBlock === 0,
);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — partial-day block subtraction verified correct, including across DST" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

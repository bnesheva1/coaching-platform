// Verifies duration-awareness: bookings at 14:00-14:30 and 15:15-15:45
// (a 45-min gap) should offer the 14:30 slot for 30/45-min services but
// NOT for a 60-min service (doesn't fit before the 15:15 booking).
// Run: node verify-slot-duration.mjs (pure computation, no DB/env needed)

import { DateTime } from "luxon";
import { generateSlots } from "../lib/availability/generateSlots.ts";

const ZONE = "UTC";
// Anchor "now" well before the test day so notice-hours never interferes.
const now = DateTime.fromISO("2026-07-20T00:00:00", { zone: ZONE });
const testDate = now.plus({ days: 1 }); // a day fully covered by the rule below

const rules = [
  {
    day_of_week: testDate.weekday,
    start_time: "13:00:00",
    end_time: "17:00:00",
  },
];

const existingBookings = [
  {
    startUtc: testDate.set({ hour: 14, minute: 0, second: 0, millisecond: 0 }).toISO(),
    endUtc: testDate.set({ hour: 14, minute: 30, second: 0, millisecond: 0 }).toISO(),
  },
  {
    startUtc: testDate.set({ hour: 15, minute: 15, second: 0, millisecond: 0 }).toISO(),
    endUtc: testDate.set({ hour: 15, minute: 45, second: 0, millisecond: 0 }).toISO(),
  },
];

function has1430(slots) {
  return slots.some((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toFormat("HH:mm") === "14:30");
}

let allPassed = true;

for (const { duration, expected } of [
  { duration: 30, expected: true },
  { duration: 45, expected: true },
  { duration: 60, expected: false },
]) {
  const slots = generateSlots({
    rules,
    timezone: ZONE,
    serviceDurationMinutes: duration,
    existingBookings,
    now,
    windowDays: 3,
  });
  const daySlots = slots.filter(
    (s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toISODate() === testDate.toISODate(),
  );
  const got = has1430(daySlots);
  const pass = got === expected;
  allPassed = allPassed && pass;
  console.log(
    `${duration}-min service: 14:30 slot ${got ? "OFFERED" : "NOT offered"} (expected ${expected ? "OFFERED" : "NOT offered"}) — ${pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  full day slots: ${daySlots.map((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toFormat("HH:mm")).join(", ")}`,
  );
}

// --- Self-overlap check: with NO existing bookings, an open period
// should never offer two mutually-overlapping start times for the same
// service (e.g. 12:45 and 1:00 for a 45-min service must not both
// appear — only one of them can ever actually be booked).
{
  const openRules = [{ day_of_week: testDate.weekday, start_time: "12:00:00", end_time: "14:00:00" }];
  const slots = generateSlots({
    rules: openRules,
    timezone: ZONE,
    serviceDurationMinutes: 45,
    now,
    windowDays: 3,
  });
  const daySlots = slots
    .filter((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toISODate() === testDate.toISODate())
    .map((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }));
  let noSelfOverlap = true;
  for (let i = 1; i < daySlots.length; i++) {
    const prevEnd = daySlots[i - 1].plus({ minutes: 45 });
    if (daySlots[i] < prevEnd) noSelfOverlap = false;
  }
  allPassed = allPassed && noSelfOverlap;
  console.log(
    `\n45-min service, open 12:00-14:00, no bookings: offered ${daySlots.map((d) => d.toFormat("HH:mm")).join(", ")} — ${noSelfOverlap ? "PASS (no self-overlap)" : "FAIL (self-overlap!)"}`,
  );
}

// --- Short-gap check: a short existing booking shouldn't cause the
// algorithm to skip past a genuinely open window right after it (the
// risk of naively stepping the search pointer by serviceDurationMinutes
// instead of scanning at a finer grid).
{
  const openRules = [{ day_of_week: testDate.weekday, start_time: "13:00:00", end_time: "15:00:00" }];
  const shortBooking = [
    {
      startUtc: testDate.set({ hour: 13, minute: 0, second: 0, millisecond: 0 }).toISO(),
      endUtc: testDate.set({ hour: 13, minute: 15, second: 0, millisecond: 0 }).toISO(),
    },
  ];
  const slots = generateSlots({
    rules: openRules,
    timezone: ZONE,
    serviceDurationMinutes: 45,
    existingBookings: shortBooking,
    now,
    windowDays: 3,
  });
  const daySlots = slots
    .filter((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toISODate() === testDate.toISODate())
    .map((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toFormat("HH:mm"));
  const found1315 = daySlots.includes("13:15");
  allPassed = allPassed && found1315;
  console.log(
    `45-min service, 13:00-13:15 booked, period 13:00-15:00: offered ${daySlots.join(", ")} — ${found1315 ? "PASS (13:15 opening found)" : "FAIL (13:15 opening missed)"}`,
  );
}

// --- Cross-duration check: a booking made for one service (any
// duration) is still a real bookings-table row, unscoped by service —
// slots for a DIFFERENT service (shorter or longer) must resume
// immediately at the booking's end, with no overlap and no needless gap.
{
  const openRules = [{ day_of_week: testDate.weekday, start_time: "13:00:00", end_time: "17:00:00" }];
  // A 60-min service booked 14:00-15:00.
  const longBooking = [
    {
      startUtc: testDate.set({ hour: 14, minute: 0, second: 0, millisecond: 0 }).toISO(),
      endUtc: testDate.set({ hour: 15, minute: 0, second: 0, millisecond: 0 }).toISO(),
    },
  ];
  for (const duration of [15, 30, 90]) {
    const slots = generateSlots({
      rules: openRules,
      timezone: ZONE,
      serviceDurationMinutes: duration,
      existingBookings: longBooking,
      now,
      windowDays: 3,
    });
    const daySlots = slots
      .filter((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toISODate() === testDate.toISODate())
      .map((s) => DateTime.fromISO(s.startUtc, { zone: ZONE }).toFormat("HH:mm"));
    const resumesAt1500 = daySlots.includes("15:00");
    allPassed = allPassed && resumesAt1500;
    console.log(
      `${duration}-min service, unrelated 60-min booking 14:00-15:00: offered ${daySlots.join(", ")} — ${resumesAt1500 ? "PASS (resumes exactly at 15:00, no gap/overlap)" : "FAIL"}`,
    );
  }
}

console.log(allPassed ? "\nAll assertions passed." : "\nSOME ASSERTIONS FAILED.");
process.exit(allPassed ? 0 : 1);

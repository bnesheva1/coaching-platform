// Proves the minimum-notice lead time actually excludes slots inside
// the window and includes the ones just outside it, and that
// minNoticeHours: 0 (the default) reproduces today's exact "not in the
// past" behavior — a regression check for verify-slot-dst.mjs and
// verify-slot-blocking.mjs, which both call generateSlots without this
// param.
//
// Run: node scripts/verify-slot-min-notice.mjs (no DB/env needed — pure
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

const everyDayRule = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
  day_of_week,
  start_time: "00:00:00",
  end_time: "23:45:00",
}));

console.log("=== A 24h notice window excludes slots inside it, includes slots just outside it ===\n");

const withNotice = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 15,
  minNoticeHours: 24,
  windowDays: 3,
  now,
});

const cutoff = now.plus({ hours: 24 });
const insideWindow = withNotice.filter(
  (s) => DateTime.fromISO(s.startUtc, { zone: "utc" }) <= cutoff,
);
const justOutside = withNotice.filter((s) => {
  const start = DateTime.fromISO(s.startUtc, { zone: "utc" });
  return start > cutoff && start < cutoff.plus({ hours: 1 });
});

check("no slot inside the 24h notice window is offered", insideWindow.length === 0);
check("a slot just outside the 24h window IS offered (sanity check)", justOutside.length > 0);

console.log("\n=== minNoticeHours: 0 (the default) reproduces today's exact behavior ===\n");

const withoutNotice = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 15,
  windowDays: 3,
  now,
});
const explicitZero = generateSlots({
  rules: everyDayRule,
  timezone: ZONE,
  serviceDurationMinutes: 15,
  minNoticeHours: 0,
  windowDays: 3,
  now,
});

check(
  "omitting minNoticeHours and passing 0 explicitly produce identical output",
  withoutNotice.length === explicitZero.length &&
    withoutNotice.every((s, i) => s.startUtc === explicitZero[i].startUtc),
);
check(
  "with no notice window, a slot starting shortly after now IS offered (only strictly-past slots excluded)",
  withoutNotice.some((s) => {
    const start = DateTime.fromISO(s.startUtc, { zone: "utc" });
    return start > now && start < now.plus({ minutes: 30 });
  }),
);

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — minimum-notice lead time verified correct" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

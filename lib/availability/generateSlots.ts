import { DateTime } from "luxon";

// Pure computation, no I/O and no "@/" imports on purpose — it's
// directly runnable/testable with plain `node` (see
// scripts/verify-slot-dst.mjs), not just inside the Next.js app.

// How far ahead to compute slots. A plain server-side constant, never
// client-controllable — an arbitrarily large requested window would be
// a cheap resource-exhaustion vector.
const WINDOW_DAYS = 14;

// Matches the grid practitioner_availability rows are already
// constrained to (both app-side and DB-side, see Epic 4) — slot start
// times land on the same 15-minute marks the underlying rules do.
const SLOT_GRID_MINUTES = 15;

export type AvailabilityRule = {
  day_of_week: number; // 1=Monday..7=Sunday (ISO 8601), matches Luxon's DateTime.weekday exactly
  start_time: string; // "HH:MM:SS", practitioner's local wall-clock time
  end_time: string; // "HH:MM:SS"
};

export type ExistingBooking = {
  startUtc: string; // ISO instant
  endUtc: string; // ISO instant
};

export type Slot = {
  startUtc: string; // ISO instant string
};

function parseTimeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

// The one place local-wall-clock + IANA zone becomes a real UTC instant,
// resolved against this specific calendar date's actual DST state — not
// a fixed offset. This is why availability is stored as wall-clock time
// + a timezone reference (Epic 4) rather than precomputed UTC: the same
// "14:00 Sofia" is a different UTC instant in January than in July.
function resolveLocalToUtc(date: DateTime, time: string, zone: string): DateTime {
  const { hour, minute } = parseTimeParts(time);
  return DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute },
    { zone },
  ).toUTC();
}

function overlaps(
  candidateStart: DateTime,
  candidateEnd: DateTime,
  booking: ExistingBooking,
): boolean {
  const bookingStart = DateTime.fromISO(booking.startUtc, { zone: "utc" });
  const bookingEnd = DateTime.fromISO(booking.endUtc, { zone: "utc" });
  return candidateStart < bookingEnd && candidateEnd > bookingStart;
}

// Pure — no I/O, no DB access — so it's directly unit-testable (see
// scripts/verify-slot-dst.mjs) without needing a live Supabase project.
export function generateSlots({
  rules,
  timezone,
  serviceDurationMinutes,
  existingBookings = [],
  blockedDates = [],
  windowDays = WINDOW_DAYS,
  now = DateTime.utc(),
}: {
  rules: AvailabilityRule[];
  timezone: string;
  serviceDurationMinutes: number;
  existingBookings?: ExistingBooking[];
  blockedDates?: string[]; // ISO "YYYY-MM-DD", in the practitioner's own calendar
  windowDays?: number;
  now?: DateTime;
}): Slot[] {
  const slots: Slot[] = [];
  const blockedDateSet = new Set(blockedDates);
  // "Today" and day-of-week iteration are anchored to the practitioner's
  // own timezone, not the server's or a client's — availability rules
  // are inherently practitioner-local concepts.
  const startOfWindow = now.setZone(timezone).startOf("day");

  for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
    const date = startOfWindow.plus({ days: dayOffset });

    // A whole-date block removes the day entirely, before any rule is
    // even considered — "block July 15th" means July 15th in the
    // practitioner's own calendar, which is exactly what `date` already
    // is at this point (set to their timezone, not UTC or the caller's).
    if (blockedDateSet.has(date.toISODate()!)) {
      continue;
    }

    const matchingRules = rules.filter((rule) => rule.day_of_week === date.weekday);

    for (const rule of matchingRules) {
      const periodStart = resolveLocalToUtc(date, rule.start_time, timezone);
      const periodEnd = resolveLocalToUtc(date, rule.end_time, timezone);

      if (!periodStart.isValid || !periodEnd.isValid) {
        console.error("generateSlots: invalid period after DST resolution, skipping", {
          date: date.toISODate(),
          rule,
          timezone,
        });
        continue;
      }

      let candidateStart = periodStart;
      while (candidateStart.plus({ minutes: serviceDurationMinutes }) <= periodEnd) {
        const candidateEnd = candidateStart.plus({ minutes: serviceDurationMinutes });

        const isPast = candidateStart <= now;
        const isBooked = existingBookings.some((booking) =>
          overlaps(candidateStart, candidateEnd, booking),
        );

        if (!isPast && !isBooked) {
          slots.push({ startUtc: candidateStart.toISO()! });
        }

        candidateStart = candidateStart.plus({ minutes: SLOT_GRID_MINUTES });
      }
    }
  }

  return slots.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

import "server-only";
import { DateTime } from "luxon";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { IMMEDIATE_CONFIG } from "./config";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type ImmediateFit =
  | { fits: true; projectedStart: string; projectedEnd: string }
  | { fits: false; reason: "collides" | "blocked" | "no_service" };

// Why immediate fit does NOT consult working hours (unlike generateSlots):
// working hours answer "when may strangers book me in ADVANCE" — a boundary that
// protects a practitioner from bookings they never agreed to. Immediate answers
// "I am here right now and willing"; the practitioner is present and choosing
// deliberately, so there's nobody to protect them from, and enforcing hours would
// foreclose exactly the 3am-session case the feature exists for. Immediate fit
// therefore respects only real conflicts: existing bookings (+ the safety buffer
// before the next one), active immediate holds, and schedule blocks. min-notice
// is dropped for the same reason as hours. Working hours continue to govern
// SCHEDULED bookings exactly as before — this is immediate-only.

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

// The immediate window for a service of `durationMinutes`: it starts a short lead
// ahead of now, and its end plus the safety buffer must clear the next booking.
function windowFor(now: Date, durationMinutes: number): { start: Date; end: Date; clearBy: Date } {
  const start = new Date(now.getTime() + IMMEDIATE_CONFIG.LEAD_BUFFER_MINUTES * 60_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const clearBy = new Date(end.getTime() + IMMEDIATE_CONFIG.SAFETY_BUFFER_MINUTES * 60_000);
  return { start, end, clearBy };
}

// Schedule blocks (availability_exceptions) as UTC ranges overlapping [from, to].
// Whole-date rows (start_time null) cover the entire local day; partial-day rows
// cover their local time range. Converted from the practitioner's local dates via
// Luxon (DST-correct), mirroring how getBookableSlots/generateSlots subtract them
// for scheduled slots — immediate must honour the same blocks.
async function blockedRangesFor(
  svc: ServiceClient,
  practitionerId: string,
  zone: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<{ start: Date; end: Date }[]> {
  const fromLocal = DateTime.fromJSDate(fromUtc, { zone }).startOf("day");
  const toLocal = DateTime.fromJSDate(toUtc, { zone }).startOf("day");
  const dates: string[] = [];
  for (let d = fromLocal; d <= toLocal; d = d.plus({ days: 1 })) {
    const iso = d.toISODate();
    if (iso) dates.push(iso);
  }
  if (dates.length === 0) return [];
  const { data } = await svc
    .from("availability_exceptions")
    .select("exception_date, start_time, end_time")
    .eq("practitioner_id", practitionerId)
    .eq("exception_type", "blocked")
    .in("exception_date", dates);

  const ranges: { start: Date; end: Date }[] = [];
  for (const r of data ?? []) {
    const date = r.exception_date as string;
    if (!r.start_time) {
      const s = DateTime.fromISO(`${date}T00:00`, { zone });
      ranges.push({ start: s.toUTC().toJSDate(), end: s.plus({ days: 1 }).toUTC().toJSDate() });
    } else {
      const s = DateTime.fromISO(`${date}T${r.start_time as string}`, { zone });
      const e = DateTime.fromISO(`${date}T${r.end_time as string}`, { zone });
      ranges.push({ start: s.toUTC().toJSDate(), end: e.toUTC().toJSDate() });
    }
  }
  return ranges;
}

// Does a session of `durationMinutes` fit for this practitioner starting ~now?
// Only real conflicts count (see the note above): bookings + active holds (via
// get_practitioner_busy_times) and schedule blocks. Recomputed at confirm too.
export async function computeImmediateFit(
  practitionerId: string,
  durationMinutes: number,
  now: Date = new Date(),
): Promise<ImmediateFit> {
  const svc = createServiceRoleClient();
  const { data: profile } = await svc.from("practitioner_profiles").select("timezone").eq("id", practitionerId).single();
  const zone = (profile?.timezone as string | null) ?? "UTC";

  const { start, end, clearBy } = windowFor(now, durationMinutes);

  const { data: busy } = await svc.rpc("get_practitioner_busy_times", {
    target_practitioner_id: practitionerId,
    window_start: start.toISOString(),
    window_end: clearBy.toISOString(),
  });
  if ((busy ?? []).length > 0) return { fits: false, reason: "collides" };

  const blocks = await blockedRangesFor(svc, practitionerId, zone, start, clearBy);
  if (blocks.some((b) => overlaps(start, clearBy, b.start, b.end))) return { fits: false, reason: "blocked" };

  return { fits: true, projectedStart: start.toISOString(), projectedEnd: end.toISOString() };
}

// Why a practitioner can't be booked immediately right now — distinguishes
// STRUCTURAL reasons (need fixing) from TEMPORARY ones (just need waiting), so the
// toggle-gate modal and the staleness notice can word them differently. For
// next_too_soon it carries when they could turn availability on (the near
// session's end, formatted in their own timezone).
export type ImmediateBlockReason =
  | { kind: "no_services" }
  | { kind: "in_session" }
  | { kind: "blocked" }
  | { kind: "next_too_soon"; shortestDurationMinutes: number; nextSessionInMinutes: number; freeAtLabel: string };

export type ImmediateAvailability = {
  // Active services that fit an immediate session right now. Empty ⇒ not bookable.
  bookableServiceIds: string[];
  // Set only when bookableServiceIds is empty — the dominant reason.
  reason: ImmediateBlockReason | null;
};

// The single source of truth for "can this practitioner take an immediate session
// right now, and if not, why." Feeds the toggle gate (§2), the tick's auto-off
// (§4), and the profile's marker + per-service book-now (§1/§3). Fetches the
// practitioner's data once and evaluates every active service in memory.
export async function computeImmediateAvailability(
  practitionerId: string,
  now: Date = new Date(),
): Promise<ImmediateAvailability> {
  const svc = createServiceRoleClient();
  const { data: profile } = await svc.from("practitioner_profiles").select("timezone").eq("id", practitionerId).single();
  const zone = (profile?.timezone as string | null) ?? "UTC";

  const { data: services } = await svc
    .from("services")
    .select("id, duration_minutes")
    .eq("practitioner_id", practitionerId)
    .eq("is_active", true);
  const active = (services ?? []) as { id: string; duration_minutes: number }[];
  if (active.length === 0) return { bookableServiceIds: [], reason: { kind: "no_services" } };

  const shortest = Math.min(...active.map((s) => s.duration_minutes));
  const longest = Math.max(...active.map((s) => s.duration_minutes));
  const widest = windowFor(now, longest);

  // One busy fetch from `now` (not now+lead) so an IN-PROGRESS session is seen,
  // and one blocks fetch, both over the widest window; per-service checks slice
  // these in memory.
  const { data: busyRows } = await svc.rpc("get_practitioner_busy_times", {
    target_practitioner_id: practitionerId,
    window_start: now.toISOString(),
    window_end: widest.clearBy.toISOString(),
  });
  const busy = ((busyRows ?? []) as { start_utc: string; end_utc: string }[]).map((b) => ({
    start: new Date(b.start_utc),
    end: new Date(b.end_utc),
  }));
  const blocks = await blockedRangesFor(svc, practitionerId, zone, now, widest.clearBy);

  // In a session right now (a booking spanning now) ⇒ not bookable at all, even if
  // a short service would technically fit after it — a clearer state to surface.
  const inSession = busy.some((b) => b.start <= now && b.end > now);
  if (inSession) return { bookableServiceIds: [], reason: { kind: "in_session" } };

  const bookableServiceIds: string[] = [];
  for (const s of active) {
    const w = windowFor(now, s.duration_minutes);
    const hitBusy = busy.some((b) => overlaps(w.start, w.clearBy, b.start, b.end));
    const hitBlock = blocks.some((b) => overlaps(w.start, w.clearBy, b.start, b.end));
    if (!hitBusy && !hitBlock) bookableServiceIds.push(s.id);
  }
  if (bookableServiceIds.length > 0) return { bookableServiceIds, reason: null };

  // Nothing fits — determine the dominant reason against the SHORTEST service's
  // window (if even that doesn't fit, nothing does).
  const shortW = windowFor(now, shortest);
  const blockHit = blocks.some((b) => overlaps(shortW.start, shortW.clearBy, b.start, b.end));
  if (blockHit) return { bookableServiceIds: [], reason: { kind: "blocked" } };

  const nearBusy = busy.filter((b) => overlaps(shortW.start, shortW.clearBy, b.start, b.end));
  if (nearBusy.length > 0) {
    const nextStart = new Date(Math.min(...nearBusy.map((b) => b.start.getTime())));
    const freeAt = new Date(Math.max(...nearBusy.map((b) => b.end.getTime())));
    return {
      bookableServiceIds: [],
      reason: {
        kind: "next_too_soon",
        shortestDurationMinutes: shortest,
        nextSessionInMinutes: Math.max(0, Math.round((nextStart.getTime() - now.getTime()) / 60_000)),
        freeAtLabel: DateTime.fromJSDate(freeAt, { zone }).toFormat("HH:mm"),
      },
    };
  }

  // Defensive fallback — a service didn't fit but no near conflict was found
  // (shouldn't happen now that hours are gone); treat as a soon-clearing block.
  return { bookableServiceIds: [], reason: { kind: "blocked" } };
}

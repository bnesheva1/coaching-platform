import "server-only";
import { DateTime } from "luxon";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { IMMEDIATE_CONFIG } from "./config";

export type ImmediateFit =
  | { fits: true; projectedStart: string; projectedEnd: string }
  | { fits: false; reason: "outside_hours" | "collides" | "no_service" };

function parseHms(hms: string): { h: number; m: number } {
  const [h, m] = hms.split(":").map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

// The immediate analogue of a scheduled slot: does `durationMinutes` fit for
// this practitioner starting at (now + LEAD_BUFFER), staying inside a published
// working-hours block and clearing the next scheduled booking by SAFETY_BUFFER?
// Same timezone + working-hours + busy-times sources as generateSlots, but
// anchored to `now` rather than a slot boundary. Computed at request time (only
// fitting services are offered) AND recomputed at confirm against the real
// projected start.
export async function computeImmediateFit(
  practitionerId: string,
  durationMinutes: number,
  now: Date = new Date(),
): Promise<ImmediateFit> {
  const supabase = createServiceRoleClient();

  const [{ data: profile }, { data: rules }] = await Promise.all([
    supabase.from("practitioner_profiles").select("timezone").eq("id", practitionerId).single(),
    supabase.from("practitioner_availability").select("day_of_week, start_time, end_time").eq("practitioner_id", practitionerId),
  ]);
  const zone = (profile?.timezone as string | null) ?? "UTC";

  const projectedStart = DateTime.fromJSDate(now, { zone }).plus({ minutes: IMMEDIATE_CONFIG.LEAD_BUFFER_MINUTES });
  const projectedEnd = projectedStart.plus({ minutes: durationMinutes });
  const clearBy = projectedEnd.plus({ minutes: IMMEDIATE_CONFIG.SAFETY_BUFFER_MINUTES });

  // The working-hours block (for the projected start's weekday, in the
  // practitioner's zone) that contains projectedStart. Luxon weekday is
  // Mon=1..Sun=7, matching practitioner_availability.day_of_week.
  const dayStart = projectedStart.startOf("day");
  let blockEnd: DateTime | null = null;
  for (const r of rules ?? []) {
    if ((r.day_of_week as number) !== projectedStart.weekday) continue;
    const s = parseHms(r.start_time as string);
    const e = parseHms(r.end_time as string);
    const bStart = dayStart.set({ hour: s.h, minute: s.m });
    const bEnd = dayStart.set({ hour: e.h, minute: e.m });
    if (projectedStart >= bStart && projectedStart < bEnd) {
      blockEnd = bEnd;
      break;
    }
  }
  if (!blockEnd) return { fits: false, reason: "outside_hours" };
  // The whole session + buffer must stay inside the working block.
  if (clearBy > blockEnd) return { fits: false, reason: "outside_hours" };

  // The next scheduled booking must not start before the session + buffer ends.
  const { data: busy } = await supabase.rpc("get_practitioner_busy_times", {
    target_practitioner_id: practitionerId,
    window_start: projectedStart.toUTC().toISO(),
    window_end: clearBy.toUTC().toISO(),
  });
  if ((busy ?? []).length > 0) return { fits: false, reason: "collides" };

  return {
    fits: true,
    projectedStart: projectedStart.toUTC().toISO() as string,
    projectedEnd: projectedEnd.toUTC().toISO() as string,
  };
}

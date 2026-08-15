import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import {
  VIDEO_CONFIG,
  VIDEO_COST_THRESHOLDS_EUR,
  freeMonthlyWebrtcMinutes,
  estimatedEurPerWebrtcMinute,
} from "./config";

export type VideoUsageProjection = {
  // PARTICIPANT-minutes (a 1:1 session of N minutes counts as N * 2).
  consumedMinutes: number; // online sessions this month already in the past
  committedMinutes: number; // online sessions this month still in the future
  projectedMinutes: number; // consumed + committed
  allowanceMinutes: number; // the plan's free monthly bucket
  overageMinutes: number; // projected minus allowance, floored at 0
  projectedCostEur: number; // overage * estimated per-minute cost
  thresholds: typeof VIDEO_COST_THRESHOLDS_EUR;
};

function monthWindowUtc(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Projects this calendar month's WebRTC participant-minutes and their estimated
// cost — the number the /admin Numbers readout shows and the cost breaker acts
// on. "Consumed" is online sessions already past; "committed" is online
// sessions still upcoming this month (already-booked capacity we're on the hook
// for). Cancelled bookings are excluded. Never throws — a query error resolves
// to a zeroed projection (fail safe, like the flags/capacity reads) so a stats
// hiccup can't fire the breaker or crash the dashboard.
export async function projectVideoUsage(now = new Date()): Promise<VideoUsageProjection> {
  const allowanceMinutes = freeMonthlyWebrtcMinutes();
  const perMinute = estimatedEurPerWebrtcMinute();
  const empty = (): VideoUsageProjection => ({
    consumedMinutes: 0,
    committedMinutes: 0,
    projectedMinutes: 0,
    allowanceMinutes,
    overageMinutes: 0,
    projectedCostEur: 0,
    thresholds: VIDEO_COST_THRESHOLDS_EUR,
  });

  const { start, end } = monthWindowUtc(now);
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("start_utc, end_utc, status")
    .eq("delivery_type", "online")
    .neq("status", "cancelled")
    .gte("start_utc", start)
    .lt("start_utc", end);
  if (error) {
    console.error("projectVideoUsage: bookings read failed", error);
    return empty();
  }

  const nowMs = now.getTime();
  let consumedMinutes = 0;
  let committedMinutes = 0;
  for (const b of data ?? []) {
    const startMs = new Date(b.start_utc as string).getTime();
    const endMs = new Date(b.end_utc as string).getTime();
    const durationMin = Math.max(0, (endMs - startMs) / 60_000);
    const participantMinutes = durationMin * VIDEO_CONFIG.CONNECTION_UNITS_PER_1TO1_SESSION;
    if (startMs <= nowMs) consumedMinutes += participantMinutes;
    else committedMinutes += participantMinutes;
  }

  const projectedMinutes = Math.round(consumedMinutes + committedMinutes);
  const overageMinutes = Math.max(0, projectedMinutes - allowanceMinutes);
  const projectedCostEur = Math.round(overageMinutes * perMinute * 100) / 100;

  return {
    consumedMinutes: Math.round(consumedMinutes),
    committedMinutes: Math.round(committedMinutes),
    projectedMinutes,
    allowanceMinutes,
    overageMinutes,
    projectedCostEur,
    thresholds: VIDEO_COST_THRESHOLDS_EUR,
  };
}

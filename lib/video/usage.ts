import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import {
  VIDEO_CONFIG,
  VIDEO_COST_THRESHOLDS_EUR,
  webrtcMinutesAllowance,
  webrtcDataAllowanceGb,
  dataGbPerParticipantMinute,
  eurPerOverageMinute,
  eurPerOverageGb,
} from "./config";

export type VideoUsageProjection = {
  // ── connection minutes (participant-minutes; a 1:1 of N min = N * 2) ──
  consumedMinutes: number; // online sessions this month already in the past
  committedMinutes: number; // online sessions this month still upcoming
  projectedMinutes: number; // consumed + committed
  minutesAllowance: number;
  minutesUtilization: number; // projected / allowance (1.0 = at the ceiling)
  // ── downstream data (GB), derived from participant-minutes ──
  projectedGb: number;
  dataAllowanceGb: number;
  dataUtilization: number;
  // ── which dimension binds, and how hard ──
  binding: "minutes" | "data";
  bindingUtilization: number;
  // ── projected monthly OVERAGE cost, EUR, summed across BOTH dimensions ──
  projectedCostEur: number;
  thresholds: typeof VIDEO_COST_THRESHOLDS_EUR;
};

function monthWindowUtc(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Projects this calendar month's WebRTC usage across BOTH metered dimensions —
// connection minutes and downstream data — and the overage cost of each. Data
// is derived from the same participant-minute base as minutes (one shared unit
// of work), so a longer session grows both proportionally. The cost the breaker
// acts on is the SUM of both overages, which means the binding dimension (data,
// in practice) is what pushes cost toward the thresholds — a minutes-only model
// never would. "Consumed" is online sessions already past; "committed" is ones
// still upcoming this month (capacity we're already on the hook for). Cancelled
// bookings are excluded. Never throws — a query error resolves to a zeroed
// projection (fail safe) so a stats hiccup can't fire the breaker or crash the
// dashboard.
export async function projectVideoUsage(now = new Date()): Promise<VideoUsageProjection> {
  const minutesAllowance = webrtcMinutesAllowance();
  const dataAllowanceGb = webrtcDataAllowanceGb();
  const gbPerMinute = dataGbPerParticipantMinute();

  const empty = (): VideoUsageProjection => ({
    consumedMinutes: 0,
    committedMinutes: 0,
    projectedMinutes: 0,
    minutesAllowance,
    minutesUtilization: 0,
    projectedGb: 0,
    dataAllowanceGb,
    dataUtilization: 0,
    binding: "data",
    bindingUtilization: 0,
    projectedCostEur: 0,
    thresholds: VIDEO_COST_THRESHOLDS_EUR,
  });

  const { start, end } = monthWindowUtc(now);
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("start_utc, end_utc, status")
    .eq("delivery_type", "online")
    // Non-cancelled bookings. NB the real statuses are cancelled_by_client /
    // cancelled_by_practitioner — a .neq("status","cancelled") matches nothing
    // and silently keeps cancelled bookings in the projection.
    .in("status", ["pending", "confirmed", "completed"])
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
  const projectedGb = Math.round(projectedMinutes * gbPerMinute * 10) / 10;

  const minutesUtilization = minutesAllowance > 0 ? projectedMinutes / minutesAllowance : 0;
  const dataUtilization = dataAllowanceGb > 0 ? projectedGb / dataAllowanceGb : 0;
  const binding = dataUtilization >= minutesUtilization ? "data" : "minutes";
  const bindingUtilization = Math.max(minutesUtilization, dataUtilization);

  // Real bill = each dimension's own overage, independently metered, then summed.
  const minutesOverage = Math.max(0, projectedMinutes - minutesAllowance);
  const dataOverageGb = Math.max(0, projectedGb - dataAllowanceGb);
  const projectedCostEur =
    Math.round((minutesOverage * eurPerOverageMinute() + dataOverageGb * eurPerOverageGb()) * 100) / 100;

  return {
    consumedMinutes: Math.round(consumedMinutes),
    committedMinutes: Math.round(committedMinutes),
    projectedMinutes,
    minutesAllowance,
    minutesUtilization,
    projectedGb,
    dataAllowanceGb,
    dataUtilization,
    binding,
    bindingUtilization,
    projectedCostEur,
    thresholds: VIDEO_COST_THRESHOLDS_EUR,
  };
}

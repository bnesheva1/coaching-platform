// The single home for every plan-dependent and tunable value in the
// video subsystem. Guiding rule (project direction): build against
// free-tier limits now, but NEVER hardcode them — upgrading a plan is a
// config/env change here, never a code change. Every plan-dependent
// value states the tier it reflects and what it becomes on the paid tier,
// so months from now it's obvious what an upgrade would improve.

export type LiveKitPlan = "build" | "ship";

// An ENV var, not a code constant, because it's environment-specific:
// production can run on Ship while preview stays on Build. Defaults to the
// free tier when unset.
export function liveKitPlan(): LiveKitPlan {
  return process.env.LIVEKIT_PLAN === "ship" ? "ship" : "build";
}

// Concurrency cap, denominated in LiveKit "connection units" (one per
// participant; a 1:1 session = 2). The booking-time capacity check is
// sum(connection_units of overlapping sessions) + 2 <= this value.
//
//   Build tier: LiveKit's hard ceiling is 100 concurrent connections. We
//               cap OUR bookings at 20 units (= 10 concurrent 1:1
//               sessions) to leave generous headroom below that ceiling
//               for reconnects/retries.
//   Ship tier:  raises the ceiling substantially. The value below is a
//               PLACEHOLDER — set it to the concurrency you provision when
//               you upgrade, then flip LIVEKIT_PLAN=ship. Nothing else
//               changes.
const MAX_CONCURRENT_CONNECTION_UNITS_BY_PLAN: Record<LiveKitPlan, number> = {
  build: 20,
  ship: 200, // PLACEHOLDER — confirm against your negotiated Ship limit on upgrade.
};

export function maxConcurrentConnectionUnits(): number {
  return MAX_CONCURRENT_CONNECTION_UNITS_BY_PLAN[liveKitPlan()];
}

// ── WebRTC usage: allowances, cost estimates, and the cost breaker ──────────
// TWO metered dimensions, because they run out at very different rates and the
// one that BINDS is data, not minutes:
//   - connection MINUTES  (participant-minutes; a 1:1 of N min = N units)
//   - downstream DATA     (GB; both participants receive the other's stream)
//
// Anchor (from the plan): a 60-min 1:1 session ≈ 120 participant-minutes and
// ~1.3–1.8 GB downstream. Build gives 5,000 min + 50 GB; Ship gives 150,000 min
// + 250 GB. By minutes Ship allows ~1,250 sessions; by DATA only ~150 — so a
// minutes-only projection would never fire the breaker for the constraint that
// actually binds. lib/video/usage.ts therefore models BOTH and drives the
// cost/breaker off whichever dimension is closer to its ceiling.
//
// These are estimates to confirm against a real LiveKit invoice — but grounded
// in the plan's figures now, not arbitrary placeholders. Correcting one, or
// moving to a paid tier, stays a one-line change here.
const MINUTES_ALLOWANCE_BY_PLAN: Record<LiveKitPlan, number> = { build: 5000, ship: 150000 };
const DATA_GB_ALLOWANCE_BY_PLAN: Record<LiveKitPlan, number> = { build: 50, ship: 250 };

// Downstream GB per participant-minute. ~1.6 GB for a 120-participant-minute
// hour-long session (mid of the 1.3–1.8 range; also what two ~2 Mbps streams
// work out to) => 1.6 / 120 ≈ 0.0133 GB per participant-minute.
const DATA_GB_PER_PARTICIPANT_MINUTE = 0.0133;

// Overage rates once an allowance is exceeded (USD ≈ EUR at this precision):
// $0.0005/min and $0.12/GB — so an hour-long session in overage is ~€0.06 of
// minutes + ~€0.19 of data ≈ €0.25, data dominating, exactly as expected.
const EUR_PER_OVERAGE_MINUTE = 0.0005;
const EUR_PER_OVERAGE_GB = 0.12;

export function webrtcMinutesAllowance(): number {
  return MINUTES_ALLOWANCE_BY_PLAN[liveKitPlan()];
}
export function webrtcDataAllowanceGb(): number {
  return DATA_GB_ALLOWANCE_BY_PLAN[liveKitPlan()];
}
export function dataGbPerParticipantMinute(): number {
  return DATA_GB_PER_PARTICIPANT_MINUTE;
}
export function eurPerOverageMinute(): number {
  return EUR_PER_OVERAGE_MINUTE;
}
export function eurPerOverageGb(): number {
  return EUR_PER_OVERAGE_GB;
}

// The cost breaker's escalating thresholds, in EUR of PROJECTED monthly WebRTC
// cost (consumed this month + committed future bookings). Evaluated daily by
// the alert sweep:
//   >= earlyAlertEur   -> a warning alert (early heads-up)
//   >= highAlertEur    -> a critical alert (getting expensive)
//   >= breakerEur      -> auto-flip the `video` switch OFF, unless the
//                         videoCostOverride flag is on (real growth, lift by
//                         hand — see lib/flags/registry.ts)
//
// NB the brief framed the first as a "€30 WEEKLY" alert. It's modeled here as a
// €30 MONTHLY-projection early-warning floor, because (a) the allowance is a
// monthly bucket, so a standalone weekly cost is ill-defined, and (b) Vercel
// Hobby's one daily cron can't do weekly cadence anyway. Same early-warning
// intent, expressed against the figure the breaker actually acts on.
export const VIDEO_COST_THRESHOLDS_EUR = {
  earlyAlertEur: 30,
  highAlertEur: 150,
  breakerEur: 300,
} as const;

export const VIDEO_CONFIG = {
  // Not plan-dependent — product decisions, identical on every tier.
  EARLY_JOIN_MINUTES: 5,
  // No grace: the room's window ends exactly at end_utc. The client
  // hard-stop disconnects both parties at end_utc, and the join window /
  // outcome resolution both key off this. (Was 10.)
  POST_SESSION_GRACE_MINUTES: 0,
  CONNECTION_UNITS_PER_1TO1_SESSION: 2,
  MAX_PARTICIPANTS_PER_SESSION: 2,

  // Applied CLIENT-SIDE at publish time by the join UI (a later slice) —
  // LiveKit's RoomServiceClient.createRoom has no bitrate parameter, so
  // this is NOT a server room-create arg. Kept here so the join UI reads
  // one config home instead of a magic number in a component.
  //   Build tier: ~2000 kbps keeps a 1:1 session within the free monthly
  //               data budget for typical usage.
  //   Ship tier:  can be raised for higher-fidelity video once the data
  //               budget is larger.
  MAX_VIDEO_BITRATE_KBPS: 2000,

  // Provider room self-destructs this long after it goes empty — the
  // PRIMARY close for the normal path (both participants leave), needing
  // no cron at all. Belt-and-braces with the token's own expiry (no new
  // joins after closes_at) and the safety sweep below.
  EMPTY_ROOM_TIMEOUT_SECONDS: 60,

  // Safety-sweep backstop: the reconcile cron force-closes any provider
  // room still open past closes_at + this margin, independent of any
  // webhook, so a missed room_finished event can't leave a room billing
  // indefinitely.
  //
  // FREE-TIER COMPROMISE (Vercel Hobby): Hobby allows only a DAILY cron,
  // so the sweep piggybacks on the existing daily send-reminders job. In
  // the worst case (a room that never empties AND whose webhook is lost)
  // a room could bill until the next daily run. In practice the empty-
  // timeout + token expiry close it far sooner; this margin only bounds
  // the genuinely-stuck case. On Vercel Pro a dedicated ~15-minute cron
  // would cut that worst-case latency dramatically, at which point this
  // margin can shrink. The interval is NOT assumed daily forever — it's
  // set by vercel.json's schedule, and this value is what the code
  // reasons about, so tightening the schedule stays a config change.
  ROOM_CLOSE_SAFETY_MARGIN_MINUTES: 30,
} as const;

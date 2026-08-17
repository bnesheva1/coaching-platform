// Every tunable value for immediate booking, in one place. Guiding rule (as in
// lib/video/config.ts): the code reasons about these, so changing a cadence is a
// change here — with one exception called out below.

export const IMMEDIATE_CONFIG = {
  // The open availability widget's unified tick: refreshes the heartbeat AND
  // polls the pending inbox in one call (the polling delivery decision). 10s
  // keeps presence fresh and surfaces a request within ~10s of a 2-minute window.
  TICK_INTERVAL_MS: 10_000,

  // Presence goes stale after ~4 missed ticks. MUST match the interval in
  // is_practitioner_available_now() (SQL can't read this constant) — the
  // migration's `interval '40 seconds'`. Change both together.
  PRESENCE_STALE_MS: 40_000,

  // A request awaits the practitioner this long, then lapses silently.
  REQUEST_TTL_MS: 120_000, // 2 minutes

  // The client's request-status poll cadence. Bounded: it STOPS the moment the
  // request reaches a terminal state (confirmed/declined/lapsed/superseded), so
  // a left-open page never polls forever.
  CLIENT_POLL_MS: 2_500,

  // Headroom before a confirmed session actually starts — the window a client
  // needs to complete payment (payment itself is the next slice). Fitting at
  // confirm is computed against now + this.
  LEAD_BUFFER_MINUTES: 3,

  // Never let an immediate session run flush into a scheduled one: its end +
  // this must still clear the next booking's start (and the working-hours block).
  SAFETY_BUFFER_MINUTES: 5,

  // Commission path only: after the practitioner confirms, the client has this
  // long to complete payment. The hold that reserves the session window expires
  // after it (enforced by time in get_practitioner_busy_times).
  PAYMENT_WINDOW_MINUTES: 5,
} as const;

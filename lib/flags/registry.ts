export type FlagScope = "deploy" | "runtime";

export type FlagDef = {
  // "runtime" = admin can override at any time (DB), also has an env baseline.
  // "deploy" = env only, never admin-toggleable.
  scope: FlagScope;
  default: boolean; // code-level fallback
  envVar: string; // deployment baseline (kept as the existing env names)
  description: string; // what it gates, in plain language
};

// The single source of truth for every boolean feature flag. Deployment-scope
// brand flags and runtime admin kill switches are the same question at
// different scopes, so they share ONE registry rather than becoming parallel
// systems. Consumers only ever call isEnabled(key) (see ./index.ts).
//
// Principle: anything gating a user-facing feature is `runtime` — toggleable
// without a redeploy, because needing to kill a feature and having to deploy
// to do it is a bad evening. `deploy` is reserved for things that genuinely
// can't change while running.
//
// NON-boolean deploy config (e.g. MIN_BOOKING_NOTICE_HOURS, a numeric floor)
// deliberately does NOT live here — the registry's contract is
// isEnabled -> boolean; a tuning value is a different concern and stays a
// standalone env read where it's used.
export const FLAGS = {
  showPhoneDelivery: {
    scope: "runtime",
    default: true,
    envVar: "SHOW_PHONE_DELIVERY_OPTION",
    description: "Offer phone as a session delivery method (practitioner service form + Browse filter).",
  },
  requireEmailConfirmation: {
    // deploy, not runtime: flipping this mid-run would strand people who
    // signed up under the other rule, so it can't safely change while live.
    scope: "deploy",
    default: false,
    envVar: "REQUIRE_EMAIL_CONFIRMATION",
    description: "Require email confirmation before a new account is usable.",
  },
  immediateBooking: {
    scope: "runtime",
    default: false,
    envVar: "IMMEDIATE_BOOKING_ENABLED",
    description: "Enable 'book now / who's online' immediate sessions (feature not shipped yet).",
  },
  sessionDocuments: {
    scope: "runtime",
    default: false,
    envVar: "SESSION_DOCUMENTS_ENABLED",
    description: "Let the two parties of a booking exchange one document each (upload/replace/download in booking details).",
  },

  // ── Admin kill switches (all runtime, default ON = normal operation) ──
  // Emergency stops an admin flips from /admin. Each is enforced at its own
  // call site (see KILL_SWITCHES below for the map); a switch with no
  // enforcement point is theatre, so every one here has exactly one.
  newBookings: {
    scope: "runtime",
    default: true,
    envVar: "NEW_BOOKINGS_ENABLED",
    description: "Accept new bookings. Off = emergency stop; existing bookings are untouched.",
  },
  clientRegistration: {
    scope: "runtime",
    default: true,
    envVar: "CLIENT_REGISTRATION_ENABLED",
    description: "Allow new CLIENT sign-ups. Off = the client signup path is closed.",
  },
  practitionerRegistration: {
    scope: "runtime",
    default: true,
    envVar: "PRACTITIONER_REGISTRATION_ENABLED",
    description: "Allow new PRACTITIONER sign-ups. Off = the practitioner signup path is closed.",
  },
  checkout: {
    scope: "runtime",
    default: true,
    envVar: "CHECKOUT_ENABLED",
    description: "Create Stripe Checkout sessions. Off = commission-model bookings can't pay (provider outage / suspected abuse).",
  },
  video: {
    scope: "runtime",
    default: true,
    envVar: "VIDEO_ENABLED",
    description: "Take new ONLINE bookings. Off = no new video sessions; already-booked sessions keep their rooms.",
  },
  // The manual override for the automatic cost breaker. When ON, the daily
  // sweep will NOT auto-flip `video` off at the €300 projection — so you can
  // keep video running through genuine growth without a deploy. It does NOT
  // turn video on by itself; it only suppresses the automatic shut-off.
  videoCostOverride: {
    scope: "runtime",
    default: false,
    envVar: "VIDEO_COST_OVERRIDE",
    description: "Suppress the automatic €300 video cost breaker (keep video on through real growth).",
  },
} as const satisfies Record<string, FlagDef>;

export type FlagKey = keyof typeof FLAGS;

// The kill switches surfaced in the /admin Controls section, in display order.
// A deliberately curated subset of the runtime flags — showPhoneDelivery and
// immediateBooking are product config, not operational emergency stops, so they
// stay out of the operator surface. videoCostOverride is grouped with `video`
// in the UI, so it's not a standalone row here.
export const KILL_SWITCHES = [
  "newBookings",
  "clientRegistration",
  "practitionerRegistration",
  "checkout",
  "video",
] as const satisfies readonly FlagKey[];

export type KillSwitchKey = (typeof KILL_SWITCHES)[number];

// Every flag an admin is allowed to toggle from the dashboard. The setFlag
// action allow-lists against this, so a forged request can't flip a deploy-scope
// flag or an unknown key. videoCostOverride is toggleable but rendered inline
// with video rather than as its own switch.
export const ADMIN_TOGGLEABLE = [...KILL_SWITCHES, "videoCostOverride"] as const satisfies readonly FlagKey[];

export type AdminToggleableKey = (typeof ADMIN_TOGGLEABLE)[number];

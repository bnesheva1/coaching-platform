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
} as const satisfies Record<string, FlagDef>;

export type FlagKey = keyof typeof FLAGS;

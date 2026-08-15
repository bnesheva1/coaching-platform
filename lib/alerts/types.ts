export type AlertSeverity = "critical" | "warning" | "info";

export type AlertType =
  | "failed_refund"
  | "payment_booking_mismatch"
  | "failed_email"
  | "webhook_failure"
  | "session_failed"
  | "unresolved_outcome"
  | "video_cost";

// What a call site hands to an adapter — what happened and how urgent, never
// how it's delivered.
export type Alert = {
  type: AlertType;
  severity: AlertSeverity;
  subject: string; // the dedupe subject (booking id, session id, …)
  message: string; // short, human
  context: Record<string, unknown>; // booking id, amount, practitioner — whatever's relevant
};

// A delivery channel. The seam holds a LIST of these (Telegram now, Slack
// later) — adding one is appending to the list in adapters/index.ts, never a
// call-site change. An unconfigured adapter is simply absent from the list;
// alerts still record to the dashboard.
export interface AlertAdapter {
  name: string;
  deliver(alert: Alert): Promise<void>;
}

// Type -> default severity (a raise point may override). Severity ROUTING
// (which channels each severity uses) is separate config, in ./index.ts.
export const ALERT_TYPES: Record<AlertType, { severity: AlertSeverity; description: string }> = {
  failed_refund: {
    severity: "warning",
    description: "A refund was triggered and Stripe rejected it — the client is owed money and doesn't have it.",
  },
  payment_booking_mismatch: {
    severity: "critical",
    description: "A payment succeeded in Stripe with no corresponding confirmed booking (a client paid and got nothing).",
  },
  failed_email: {
    severity: "warning",
    description: "Resend rejected or errored — a transactional email (e.g. a booking confirmation) wasn't delivered.",
  },
  webhook_failure: {
    severity: "critical",
    description: "Stripe/LiveKit webhook delivery failed repeatedly rather than once.",
  },
  session_failed: {
    severity: "warning",
    description: "A video room never provisioned — a platform failure, not a user no-show.",
  },
  unresolved_outcome: {
    severity: "warning",
    description: "A session is past its window with outcome still null (would have caught the resolver bug weeks earlier).",
  },
  video_cost: {
    // Default severity; the raise point escalates to critical when the breaker
    // actually fires (or is only held off by the manual override).
    severity: "warning",
    description: "Projected monthly WebRTC cost crossed an alert/breaker threshold.",
  },
};

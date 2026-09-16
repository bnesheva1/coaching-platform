// Gated-content configuration. Framework-free constants read at module load.

// The payout hold for a CONTENT purchase before its practitioner transfer is
// released by the sweep — deliberately its own knob, distinct from a booking's
// PAYOUT_HOLD_HOURS (48h, anchored to session end). Content has no session, so
// the hold is measured from purchase time; default 24h (not immediate — leaves a
// short window for a technical-failure refund before the money moves).
export const CONTENT_PAYOUT_HOLD_HOURS = Number(process.env.CONTENT_PAYOUT_HOLD_HOURS ?? "24") || 24;

// Hard cap on a master PDF upload (server-side; the bucket's file_size_limit is a
// higher backstop). 20MB default.
export const CONTENT_PDF_MAX_BYTES = Number(process.env.CONTENT_PDF_MAX_BYTES ?? String(20 * 1024 * 1024)) || 20 * 1024 * 1024;

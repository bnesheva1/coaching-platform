// Session document attachments — deployment configuration.
//
// These are deploy-scope tuning values, read once at module load (same
// shape and reasoning as COMMISSION_RATE in lib/payments/stripe/checkout.ts).
// They are env-only on purpose: a practitioner must NOT be able to raise
// the size cap or the retention window from the UI — the size a client is
// forced to open and how long the platform holds a file are operator
// decisions, not per-practitioner ones. A malformed/negative value falls
// back to the default rather than silently disabling the limit.

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// The authoritative upload size cap. The bucket's own file_size_limit is
// a much higher hard backstop (see the bucket migration) — this is the
// real knob. Default 5MB: comfortably handles a scanned contract, and
// keeps roughly 200 documents inside the shared 1GB free tier.
export const SESSION_DOCUMENT_MAX_BYTES = positiveIntEnv(process.env.SESSION_DOCUMENT_MAX_BYTES, 5 * 1024 * 1024);

// Days after a session (booking.end_utc) before the file is permanently
// deleted. Anchored to the session, not the upload, so a contract sent
// before a consultation survives the consultation. Default 14: covers the
// realistic use (a practitioner sending a summary, a client who doesn't
// check right away) without holding files longer than needed.
export const SESSION_DOCUMENT_RETENTION_DAYS = positiveIntEnv(process.env.SESSION_DOCUMENT_RETENTION_DAYS, 14);

// How many days before deletion both parties are warned.
export const SESSION_DOCUMENT_RETENTION_WARN_DAYS = positiveIntEnv(process.env.SESSION_DOCUMENT_RETENTION_WARN_DAYS, 3);

// The fixed, non-configurable format allowlist: allowed MIME type ->
// canonical file extension. Both the server action and the storage
// bucket enforce this set; the extension is what the stored object's
// path uses (the display name keeps the user's original filename).
export const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
} as const;

export type AllowedDocumentMime = keyof typeof ALLOWED_DOCUMENT_TYPES;

// The <input type="file"> accept attribute — mirrors the allowlist so the
// native picker nudges toward valid files (the server-side magic-byte
// check is what actually enforces it).
export const DOCUMENT_ACCEPT_ATTR = ".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

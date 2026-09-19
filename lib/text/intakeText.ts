// Plain-text sanitizer for the per-service intake prompt (practitioner) and the
// per-booking answer (client). Both are user-submitted text rendered back to the
// other party, so they follow the same discipline as the taxonomy-suggestion
// sanitizer (practitioner-dashboard/actions.ts): stored as plain text, control
// characters stripped, length enforced. Unlike that one, newlines and tabs are
// PRESERVED — an answer like a birth date/time/place is naturally multi-line —
// so this is not used anywhere near an email header. Output is always rendered
// through React's default escaping (never dangerouslySetInnerHTML), so a stored
// "<script>" is inert text, not markup.

export const MAX_INTAKE_LENGTH = 300;

// C0 controls (except \t = U+0009 and \n = U+000A) + DEL + C1 controls. Built
// from an ASCII escape string so no literal control byte lives in this source.
// \r is normalised to \n before this runs.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");

export function sanitizeIntakeText(raw: string | null | undefined): string {
  return (raw ?? "")
    // Normalise line endings so a CRLF pasted from Windows doesn't count double.
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    // Trim trailing spaces per line, then collapse 3+ blank lines to one blank
    // line — keeps intentional breaks, drops noise.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_INTAKE_LENGTH);
}

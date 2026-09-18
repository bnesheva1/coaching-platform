// IBAN validation for DAC7 reporting — the reportable seller's bank account
// identifier. Stripe only ever returns the bank account's last4, never the full
// number, so we collect and store the IBAN ourselves (same as the TIN).
//
// Pure module (no imports) so it unit-tests via a plain `node` run.

// Structure: 2-letter country + 2 check digits + 11–30 alphanumeric (total 15–34).
const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

// Full ISO 13616 / ISO 7064 MOD-97-10 validation — not a length check. Move the
// first 4 chars to the end, map letters to numbers (A=10 … Z=35), and the whole
// number mod 97 must equal 1. Computed digit-by-digit so no BigInt is needed.
export function validateIban(raw: string): boolean {
  const s = normalizeIban(raw);
  if (!IBAN_SHAPE.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const mapped = ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch; // A→"10" … Z→"35"
    for (const digit of mapped) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

// Normalise: strip spaces, uppercase. IBANs are stored/compared without spaces.
export function normalizeIban(raw: string): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

// Validate + normalise; returns the stored form or null if invalid.
export function parseIban(raw: string): string | null {
  const s = normalizeIban(raw);
  return validateIban(s) ? s : null;
}

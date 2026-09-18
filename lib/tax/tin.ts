// TIN (Tax Identification Number) validation for DAC7 reporting.
//
// A Bulgarian individual practitioner's TIN is their ЕГН (10 digits, with a
// weighted checksum + an embedded birth date). A VAT-registered practitioner
// gives their VAT number instead (BG + 9 or 10 digits). Per the DAC7 rules the
// ЕГН doubles as both the national ID and the TIN — see the deferred-DAC7 memo.
//
// Pure module (no imports) so it unit-tests via a plain `node` run.

export type TinType = "egn" | "vat";

// Full ЕГН validation: 10 digits, a plausible embedded birth date (with the
// standard month offsets — +40 for 2000+, +20 for 1800s), AND the official
// mod-11 weighted checksum. Not a length check.
export function validateEgn(egn: string): boolean {
  if (!/^\d{10}$/.test(egn)) return false;
  const d = egn.split("").map(Number);

  // Embedded birth date: YY MM DD, month carries the century offset.
  let year = d[0] * 10 + d[1];
  let month = d[2] * 10 + d[3];
  const day = d[4] * 10 + d[5];
  if (month >= 41 && month <= 52) {
    month -= 40;
    year += 2000;
  } else if (month >= 21 && month <= 32) {
    month -= 20;
    year += 1800;
  } else if (month >= 1 && month <= 12) {
    year += 1900;
  } else {
    return false;
  }
  // Real per-month day validity (accounts for leap years).
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;

  // mod-11 weighted checksum over the first 9 digits.
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * weights[i];
  let check = sum % 11;
  if (check === 10) check = 0;
  return check === d[9];
}

// Bulgarian VAT number: BG + 9 or 10 digits. Format-validated (per spec) — the
// 9/10-digit body has its own multi-branch checksum by entity type that we don't
// enforce here; a 10-digit body is typically a valid ЕГН, which we don't require
// but the format admits.
export function validateBgVat(vat: string): boolean {
  return /^BG\d{9,10}$/.test(vat);
}

// Normalise raw input: trim, strip internal spaces; for VAT uppercase and add a
// missing "BG" prefix if the user typed only digits.
export function normalizeTin(type: TinType, raw: string): string {
  const compact = (raw ?? "").replace(/\s+/g, "");
  if (type === "vat") {
    const up = compact.toUpperCase();
    return /^\d+$/.test(up) ? `BG${up}` : up;
  }
  return compact;
}

// Validate a (type, raw) pair; returns the normalised value or null if invalid.
export function validateTin(type: TinType, raw: string): string | null {
  const value = normalizeTin(type, raw);
  if (type === "egn") return validateEgn(value) ? value : null;
  if (type === "vat") return validateBgVat(value) ? value : null;
  return null;
}

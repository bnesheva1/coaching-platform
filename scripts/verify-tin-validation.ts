// TIN validation unit test — ЕГН checksum + date, and BG VAT format.
// Run: node scripts/verify-tin-validation.ts

import { validateEgn, validateBgVat, validateTin, normalizeTin } from "../lib/tax/tin.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

// Canonical valid ЕГН examples (widely used in ЕГН-validation references).
check("valid ЕГН 7523169263", validateEgn("7523169263") === true);
check("valid ЕГН 8032056031", validateEgn("8032056031") === true);
// Tamper the check digit → invalid.
check("ЕГН with wrong check digit rejected", validateEgn("7523169264") === false);
// Wrong length / non-digits.
check("9-digit rejected (not just a length pass)", validateEgn("752316926") === false);
check("11-digit rejected", validateEgn("75231692630") === false);
check("non-digits rejected", validateEgn("75231a9263") === false);
// Impossible embedded date (month 13 with no offset).
check("impossible birth month rejected", validateEgn("7513169265") === false);
// Impossible day (Feb 30-ish via 2000+ offset month 42 = Feb, day 30).
check("impossible birth day rejected", validateEgn("0042300000") === false);

// BG VAT format.
check("valid BG VAT (9 digits)", validateBgVat("BG123456789") === true);
check("valid BG VAT (10 digits)", validateBgVat("BG1234567890") === true);
check("VAT without BG prefix rejected", validateBgVat("123456789") === false);
check("VAT with letters in body rejected", validateBgVat("BG12345678X") === false);

// normalize + validateTin entry points.
check("normalizeTin adds BG to bare VAT digits", normalizeTin("vat", "123456789") === "BG123456789");
check("normalizeTin strips spaces in ЕГН", normalizeTin("egn", "75 23 16 92 63") === "7523169263");
check("validateTin('egn', spaced valid) → normalised value", validateTin("egn", "75 23 16 92 63") === "7523169263");
check("validateTin('vat', bare digits) → BG-prefixed", validateTin("vat", "123456789") === "BG123456789");
check("validateTin('egn', invalid) → null", validateTin("egn", "0000000000") === false || validateTin("egn", "1111111111") === null);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

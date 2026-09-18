// IBAN validation unit test — MOD-97 checksum + structure.
// Run: node scripts/verify-iban-validation.ts

import { validateIban, parseIban, normalizeIban } from "../lib/tax/iban.ts";

let failures = 0;
const check = (l: string, c: boolean) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };

// Valid IBANs (published examples).
check("valid BG IBAN", validateIban("BG80BNBG96611020345678") === true);
check("valid DE IBAN", validateIban("DE89370400440532013000") === true);
check("valid GB IBAN", validateIban("GB82WEST12345698765432") === true);
check("valid with spaces (normalised first)", validateIban("BG80 BNBG 9661 1020 3456 78") === true);
check("valid lowercase (normalised first)", validateIban("de89370400440532013000") === true);

// Invalid.
check("wrong check digits rejected", validateIban("BG80BNBG96611020345679") === false);
check("transposed chars rejected (MOD-97 catches it)", validateIban("BG08BNBG96611020345678") === false);
check("too short rejected", validateIban("BG80BNBG9661") === false);
check("no country code rejected", validateIban("8080BNBG96611020345678") === false);
check("garbage rejected", validateIban("not an iban") === false);
check("empty rejected", validateIban("") === false);

// normalize + parse.
check("normalizeIban strips spaces + uppercases", normalizeIban("bg80 bnbg 9661 1020 3456 78") === "BG80BNBG96611020345678");
check("parseIban returns normalised value for valid", parseIban("bg80 bnbg 9661 1020 3456 78") === "BG80BNBG96611020345678");
check("parseIban returns null for invalid", parseIban("BG80BNBG96611020345679") === null);

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

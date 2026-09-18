// Structured-address validation unit test.
// Run: node scripts/verify-address-validation.ts

import { validateAddress, normalizeAddress } from "../lib/tax/address.ts";

let failures = 0;
const check = (l: string, c: boolean) => { console.log(`${c ? "PASS" : "FAIL"} — ${l}`); if (!c) failures++; };

const base = { street: "ul. Vitosha", building: "12A", postcode: "1000", city: "Sofia", country: "BG" };

check("valid BG address accepted", validateAddress(base).ok === true);
check("lowercase country normalised + accepted", validateAddress({ ...base, country: "bg" }).ok === true);
check("valid non-BG address accepted", validateAddress({ street: "Main St", building: "1", postcode: "SW1A1AA", city: "London", country: "GB" }).ok === true);

const missingStreet = validateAddress({ ...base, street: "" });
check("missing street → field 'street'", !missingStreet.ok && missingStreet.field === "street");
const missingBuilding = validateAddress({ ...base, building: "  " });
check("blank building → field 'building'", !missingBuilding.ok && missingBuilding.field === "building");
const badCountry = validateAddress({ ...base, country: "BGR" });
check("3-letter country → field 'country'", !badCountry.ok && badCountry.field === "country");
const badBgPostcode = validateAddress({ ...base, postcode: "12" });
check("BG postcode not 4 digits → field 'postcode'", !badBgPostcode.ok && badBgPostcode.field === "postcode");
const bgPostcodeLetters = validateAddress({ ...base, postcode: "10AB" });
check("BG postcode with letters → field 'postcode'", !bgPostcodeLetters.ok && bgPostcodeLetters.field === "postcode");

check("normalizeAddress trims + uppercases country + strips postcode spaces", (() => {
  const n = normalizeAddress({ street: " ul. Vitosha ", building: " 12A ", postcode: "10 00", city: " Sofia ", country: "bg" });
  return n.street === "ul. Vitosha" && n.building === "12A" && n.postcode === "1000" && n.city === "Sofia" && n.country === "BG";
})());

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

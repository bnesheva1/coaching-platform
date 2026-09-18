// Structured mailing address for DAC7 reporting (an individual seller's
// residential address). Captured as discrete fields, not free text, so the
// filing formatter can map them to the OECD address elements. The OECD address
// TYPE code (e.g. legalAddressType="OECD303") is export-format metadata handled
// at filing time — not stored here.
//
// Pure module (no imports) so it unit-tests via a plain `node` run.

export type PractitionerAddress = { street: string; building: string; postcode: string; city: string; country: string };
export type AddressField = keyof PractitionerAddress;

const COUNTRY = /^[A-Z]{2}$/; // ISO 3166-1 alpha-2

export function normalizeAddress(a: PractitionerAddress): PractitionerAddress {
  return {
    street: a.street.trim(),
    building: a.building.trim(),
    postcode: a.postcode.replace(/\s+/g, ""),
    city: a.city.trim(),
    country: a.country.trim().toUpperCase(),
  };
}

// Validate a structured address. An address is all-or-nothing (every field
// required). Postcode is country-aware: Bulgarian postcodes are exactly 4
// digits; other countries just need a non-empty short value. Returns the
// normalised address, or which field failed.
export function validateAddress(a: PractitionerAddress): { ok: true; value: PractitionerAddress } | { ok: false; field: AddressField } {
  const n = normalizeAddress(a);
  if (!COUNTRY.test(n.country)) return { ok: false, field: "country" };
  if (!n.street || n.street.length > 200) return { ok: false, field: "street" };
  if (!n.building || n.building.length > 30) return { ok: false, field: "building" };
  if (!n.city || n.city.length > 100) return { ok: false, field: "city" };
  if (n.country === "BG") {
    if (!/^\d{4}$/.test(n.postcode)) return { ok: false, field: "postcode" };
  } else if (!n.postcode || n.postcode.length > 12) {
    return { ok: false, field: "postcode" };
  }
  return { ok: true, value: n };
}

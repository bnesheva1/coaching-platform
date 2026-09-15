// White-label brand config — deliberately framework-free (only reads
// process.env). It's imported by i18n/routing.ts (which the EDGE middleware
// pulls in) and by next.config.ts, so it must NOT import next-intl/server or
// anything server-component-only. The display name (getSiteName) stays in
// lib/brand.ts, which does need next-intl.

// The brands this codebase can render. A brand is a full visual+locale identity
// (palette in app/tokens/colors.css, fonts in the layout, locales below),
// chosen by the BRAND env var. Unset → "warm".
//
// "three" is a re-skin of "two": it reuses brand two's ENTIRE layout and
// identity (the notebook UI, the product name) and differs ONLY in palette
// (it inherits the warm/v1 colors — no color block of its own in colors.css)
// and fonts (Vollkorn display + Roboto body). Everywhere the app branches on
// "is this the brand-two experience?", it must use layoutBrand() below so
// three answers yes — see that helper.
export const BRANDS = ["warm", "two", "three"] as const;
export type Brand = (typeof BRANDS)[number];

export function resolveBrand(): Brand {
  const raw = process.env.BRAND?.trim().toLowerCase();
  return (BRANDS as readonly string[]).includes(raw ?? "") ? (raw as Brand) : "warm";
}

// The brand whose LAYOUT + identity (structure, product name, notebook UI)
// applies — as opposed to its palette/fonts. Brand three borrows all of brand
// two's structure, so it maps to "two" here; every structural branch point
// (`layoutBrand() === "two"`) then treats two and three identically, while the
// palette (colors.css) and fonts (layout.tsx BRAND_FONTS) still differ per the
// real resolved brand. Warm is its own layout.
export function layoutBrand(brand: Brand = resolveBrand()): Brand {
  return brand === "three" ? "two" : brand;
}

// The locales that EXIST in the codebase (messages/<locale>.json). A brand
// serves a SUBSET of these; a locale that a brand omits stays in the files,
// just inactive for that brand.
export type Locale = "bg" | "en";

// Which locales each brand SERVES. This is the single source of truth for
// routing: the URL prefix strategy is DERIVED from the count (see
// i18n/routing.ts) — one locale → served at the root, no prefix; multiple →
// all prefixed. The two can't disagree because there's no separate toggle.
export const BRAND_LOCALES: Record<Brand, Locale[]> = {
  // samodapopitam.bg is Bulgarian-only. English remains in messages/en.json for
  // future brands that list it.
  warm: ["bg"],
  // Brand two (high-contrast black-and-white / notebook) — bg-only for now, same
  // as warm, so routing stays unprefixed. The handoff is bilingual; add "en"
  // here to switch it on (and update the Supabase redirect allowlist), but that
  // wasn't in scope for this pass.
  two: ["bg"],
  // Brand three (brand two's notebook layout re-skinned with the warm/v1 palette
  // + Vollkorn/Roboto) — same bg-only scope as the brand it re-skins.
  three: ["bg"],
};

export function brandLocales(): Locale[] {
  return BRAND_LOCALES[resolveBrand()];
}

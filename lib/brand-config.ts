// White-label brand config — deliberately framework-free (only reads
// process.env). It's imported by i18n/routing.ts (which the EDGE middleware
// pulls in) and by next.config.ts, so it must NOT import next-intl/server or
// anything server-component-only. The display name (getSiteName) stays in
// lib/brand.ts, which does need next-intl.

// The brands this codebase can render. A brand is a full visual+locale identity
// (palette in app/tokens/colors.css, fonts in the layout, locales below),
// chosen by the BRAND env var. Unset → "warm".
export const BRANDS = ["warm", "two"] as const;
export type Brand = (typeof BRANDS)[number];

export function resolveBrand(): Brand {
  const raw = process.env.BRAND?.trim().toLowerCase();
  return (BRANDS as readonly string[]).includes(raw ?? "") ? (raw as Brand) : "warm";
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
};

export function brandLocales(): Locale[] {
  return BRAND_LOCALES[resolveBrand()];
}

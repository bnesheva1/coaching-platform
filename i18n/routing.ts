import { defineRouting } from "next-intl/routing";
import { brandLocales } from "@/lib/brand-config";

// Locales + the URL-prefix strategy are DERIVED from the active brand's locale
// list (lib/brand-config.ts), never a separate setting — so they can't
// disagree. One active locale → served at the root with NO prefix (/, /browse,
// /p/username). Multiple → every URL carries its locale (/bg/…, /en/…). English
// stays in the codebase; a brand simply lists which locales it serves.
const locales = brandLocales();

export const routing = defineRouting({
  locales,
  defaultLocale: locales[0],
  localePrefix: locales.length === 1 ? "never" : "always",
});

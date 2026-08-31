import { getTranslations } from "next-intl/server";

// White-label brand selection. A brand is a named token set (palette in
// app/tokens/colors.css, fonts in the layout's BRAND_FONTS map), chosen by the
// BRAND env var. Unset → "warm" (the original palette + fonts), so a default
// deployment is unchanged; a second deployment sets BRAND=<name> to swap the
// whole visual identity with no code change. Adding a brand = a colors.css
// [data-brand] block + a BRAND_FONTS entry + its name here.
export const BRANDS = ["warm"] as const;
export type Brand = (typeof BRANDS)[number];

export function resolveBrand(): Brand {
  const raw = process.env.BRAND?.trim().toLowerCase();
  return (BRANDS as readonly string[]).includes(raw ?? "") ? (raw as Brand) : "warm";
}

// The platform's display name — the single dedicated source (Brand.siteName).
// Consumers (metadata titles, the nav wordmark, structured data) ask "what is
// this platform called?" through here rather than reaching into homepage
// translations. Emails resolve the same Brand.siteName key via the sync
// translator in lib/email/shared.ts (a different i18n context, same source).
export async function getSiteName(locale?: string): Promise<string> {
  const t = locale
    ? await getTranslations({ locale, namespace: "Brand" })
    : await getTranslations("Brand");
  return t("siteName");
}

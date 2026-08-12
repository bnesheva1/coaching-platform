import { getTranslations } from "next-intl/server";

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

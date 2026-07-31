import { routing } from "@/i18n/routing";

// Vercel's own domain — this project has no custom domain configured yet
// (confirmed via `vercel domains ls`: none). Swap this one constant if
// that changes; every hreflang/canonical URL in the app flows through it.
export const SITE_URL = "https://coaching-platform-tau.vercel.app";

// Every static/marketing page's generateMetadata calls this with its own
// locale + locale-agnostic pathname (e.g. "/how-it-works", no leading
// locale segment) to get a consistent alternates block: a canonical
// pointing at the CURRENT locale's URL, plus one <link rel="alternate
// hreflang"> per supported locale so search engines can offer the right
// language version — and x-default, so a visitor with no locale
// preference lands on the site's default (bg) rather than an arbitrary
// pick.
export function localizedAlternates(locale: string, pathname: string) {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}${pathname}`;
  }
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${pathname}`;

  return {
    canonical: `${SITE_URL}/${locale}${pathname}`,
    languages,
  };
}

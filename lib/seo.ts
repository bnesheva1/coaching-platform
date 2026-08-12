import { routing } from "@/i18n/routing";

// The deployment's public origin — feeds every canonical, hreflang, sitemap
// entry and JSON-LD URL. Deployment-scoped config (SITE_URL env), so a second
// brand on a different domain sets it once rather than silently attributing
// all SEO signals to this domain. The fallback is this deployment's own
// domain, so the primary keeps working if the var is unset — but a second
// deployment MUST set SITE_URL or its URLs will point here. Server-only (no
// NEXT_PUBLIC): every consumer is server-side (metadata, sitemap, robots,
// JSON-LD).
export const SITE_URL = process.env.SITE_URL ?? "https://coaching-platform-tau.vercel.app";

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

// Collapse whitespace and cut to a meta-description-friendly length at a
// word boundary, adding an ellipsis when actually truncated. Used for
// profile descriptions derived from free-text bios of unknown length.
export function truncateForMeta(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trim()}…`;
}

// A practitioner profile's <title>. Keyword-first (name + their specialties,
// the actual searchable terms) with the brand appended — so every profile is
// distinct instead of the shared homepage title. No specialties yet → just
// the name + brand.
export function profileMetaTitle(name: string, specialtyLabels: string[], siteName: string): string {
  const base = specialtyLabels.length > 0 ? `${name} — ${specialtyLabels.join(", ")}` : name;
  return `${base} | ${siteName}`;
}

// A profile's meta description, degrading gracefully: their headline if set,
// else the start of their bio, else a caller-supplied generic fallback — so a
// practitioner with a thin or empty bio still gets a sensible, non-empty
// description rather than inheriting the homepage's.
export function profileMetaDescription({
  headline,
  bio,
  fallback,
}: {
  headline?: string | null;
  bio?: string | null;
  fallback: string;
}): string {
  const h = headline?.trim();
  if (h) return truncateForMeta(h);
  const b = bio?.trim();
  if (b) return truncateForMeta(b);
  return fallback;
}

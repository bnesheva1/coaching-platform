import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/lib/brand-config";

// Absolute URL for a locale-agnostic path, with the locale prefix applied only
// when the routing strategy uses one (getPathname respects localePrefix — no
// prefix for a single-locale brand, /<locale> for a multi-locale one).
function localizedUrl(pathname: string, locale: Locale): string {
  return `${SITE_URL}${getPathname({ href: pathname, locale })}`;
}

// The deployment's public origin — feeds every canonical, hreflang, sitemap
// entry and JSON-LD URL. Deployment-scoped config (SITE_URL env). Server-only
// (no NEXT_PUBLIC): every consumer is server-side (metadata, sitemap, robots,
// JSON-LD).
//
// Fail LOUD, never mask: a real production deployment MUST set SITE_URL. If it's
// unset there, throw — a build/boot failure with a clear message is far better
// than silently attributing every SEO signal to a stale or wrong domain (the
// old fallback pointed at the Vercel domain, so a typo/missing var would quietly
// send all canonicals there). Gated on VERCEL_ENV === "production" so only the
// real production deploy is strict; local dev and any non-Vercel run fall back
// to the dev origin, where SEO is irrelevant.
const configuredSiteUrl = process.env.SITE_URL?.trim();
if (!configuredSiteUrl && process.env.VERCEL_ENV === "production") {
  throw new Error(
    "SITE_URL is not set in production. Every canonical, hreflang, sitemap and JSON-LD URL derives from it, so an unset value would attribute all SEO to the wrong domain. Set SITE_URL to the production origin (e.g. https://www.samodapopitam.bg).",
  );
}
export const SITE_URL = configuredSiteUrl ?? "http://localhost:3000";

// Every static/marketing page's generateMetadata calls this with its own
// locale + locale-agnostic pathname (e.g. "/how-it-works", no leading
// locale segment) to get a consistent alternates block: a canonical
// pointing at the CURRENT locale's URL, plus one <link rel="alternate
// hreflang"> per supported locale so search engines can offer the right
// language version — and x-default, so a visitor with no locale
// preference lands on the site's default (bg) rather than an arbitrary
// pick.
export function localizedAlternates(locale: string, pathname: string) {
  const canonical = localizedUrl(pathname, locale as Locale);

  // With a single served locale there's no alternate language to point at — emit
  // only the canonical, not a self-referencing hreflang pair against a locale
  // this brand doesn't serve.
  if (routing.locales.length === 1) {
    return { canonical };
  }

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = localizedUrl(pathname, l);
  }
  languages["x-default"] = localizedUrl(pathname, routing.defaultLocale);

  return { canonical, languages };
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

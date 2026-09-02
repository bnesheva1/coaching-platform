import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/lib/brand-config";
import { SITE_URL } from "@/lib/seo";
import { searchPractitioners } from "@/lib/practitioners/search";

const urlFor = (pathname: string, locale: Locale) => `${SITE_URL}${getPathname({ href: pathname, locale })}`;

// Dynamic so newly-bookable practitioners appear automatically without a
// rebuild. searchPractitioners reads request cookies (anonymous here), which
// forces dynamic rendering — fine for a sitemap crawlers hit occasionally.
export const dynamic = "force-dynamic";

// Locale-agnostic public paths; every locale gets its own <url>. Excludes the
// dashboards, auth, and API — those are disallowed in robots.ts.
const STATIC_PATHS = [
  "",
  "/browse",
  "/how-it-works",
  "/become-a-practitioner",
  "/about",
  "/faq",
  "/contact",
  "/privacy",
];

// hreflang alternates for one path — every locale plus x-default -> the
// default locale, matching lib/seo.ts's localizedAlternates. Omitted entirely
// for a single served locale (nothing to alternate against).
function languagesFor(pathname: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = urlFor(pathname, l);
  languages["x-default"] = urlFor(pathname, routing.defaultLocale);
  return languages;
}

function entriesForPath(pathname: string): MetadataRoute.Sitemap {
  const single = routing.locales.length === 1;
  const languages = single ? null : languagesFor(pathname);
  return routing.locales.map((locale) => ({
    url: urlFor(pathname, locale),
    ...(languages ? { alternates: { languages } } : {}),
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries = STATIC_PATHS.flatMap(entriesForPath);

  // Only BOOKABLE practitioners — searchPractitioners defaults to
  // onlyBookable, the exact filter Browse uses. A sitemap full of unbookable
  // profiles would waste crawl budget and send visitors to dead ends.
  const practitioners = await searchPractitioners({ onlyBookable: true });
  const profileEntries = practitioners.flatMap((p) => entriesForPath(`/p/${p.username}`));

  return [...staticEntries, ...profileEntries];
}

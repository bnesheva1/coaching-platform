import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getPathname } from "@/i18n/navigation";
import { SITE_URL } from "@/lib/seo";

// The per-user dashboards, disallowed for every SERVED locale — derived from the
// routing config so it follows the prefix strategy (unprefixed for a
// single-locale brand, /<locale>/… for a multi-locale one) instead of
// hardcoding /bg//en/. The path prefix covers their sub-routes too.
const DASHBOARD_PATHS = ["/client-dashboard", "/practitioner-dashboard"];

// Public pages are crawlable; the per-user dashboards and the API/auth surface
// are not (nothing there is indexable content, and it wastes crawl budget).
// Points crawlers at the dynamic sitemap.
export default function robots(): MetadataRoute.Robots {
  const dashboardDisallow = routing.locales.flatMap((locale) =>
    DASHBOARD_PATHS.map((path) => getPathname({ href: path, locale })),
  );
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...dashboardDisallow, "/api/", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

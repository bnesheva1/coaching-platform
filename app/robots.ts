import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Public pages are crawlable; the per-user dashboards and the API/auth
// surface are not (nothing there is indexable content, and it wastes crawl
// budget). Dashboard paths are disallowed for both locales, and the prefix
// covers their sub-routes too. Points crawlers at the dynamic sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/bg/client-dashboard",
        "/en/client-dashboard",
        "/bg/practitioner-dashboard",
        "/en/practitioner-dashboard",
        "/api/",
        "/auth/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

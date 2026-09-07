import type { Metadata } from "next";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { getTranslations } from "next-intl/server";
import { localizedAlternates, SITE_URL } from "@/lib/seo";
import { getPathname } from "@/i18n/navigation";
import { Hero } from "./Hero";
import { HomeAvailableNowLine } from "./HomeAvailableNowLine";
import { BrandTwoHome } from "@/components/homepage/BrandTwoHome";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HomePage" });
  return {
    title: await getSiteName(locale),
    description: t("metaDescription"),
    // Homepage path is just the locale root (pathname ""), so this yields
    // canonical /{locale} + hreflang for each locale + x-default -> bg.
    alternates: localizedAlternates(locale, ""),
  };
}

// Header now comes from the root locale layout's SiteHeader, mounted
// once for every route — this page no longer renders its own.
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Homepage structured data — Organization + WebSite, via the same JSON-LD pattern
  // as /faq and /p/[username] (stringify + escape "<" + a single ld+json <script>).
  // Name/URL come from the brand config (getSiteName + SITE_URL, same source as
  // everything else); the logo reuses the brand-derived /api/og render — nothing
  // hardcoded, so it stays correct across white-label deployments.
  const siteName = await getSiteName(locale);
  const homeUrl = `${SITE_URL}${getPathname({ href: "/", locale })}`;
  const browseUrl = `${SITE_URL}${getPathname({ href: "/browse", locale })}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: siteName,
        url: homeUrl,
        logo: `${SITE_URL}/api/og`,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: siteName,
        url: homeUrl,
        publisher: { "@id": `${SITE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${browseUrl}?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
  const jsonLdScript = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  // Brand two gets its own hero (handoff 1b); brand one keeps the existing one.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
      {resolveBrand() === "two" ? (
        <BrandTwoHome />
      ) : (
        <div>
          <Hero />
          <HomeAvailableNowLine />
        </div>
      )}
    </>
  );
}

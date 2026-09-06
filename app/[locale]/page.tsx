import type { Metadata } from "next";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { getTranslations } from "next-intl/server";
import { localizedAlternates } from "@/lib/seo";
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
export default function Home() {
  // Brand two gets its own hero (handoff 1b); brand one keeps the existing one.
  if (resolveBrand() === "two") {
    return <BrandTwoHome />;
  }
  return (
    <div>
      <Hero />
      <HomeAvailableNowLine />
    </div>
  );
}

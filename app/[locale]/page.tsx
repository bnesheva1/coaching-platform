import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Hero } from "./Hero";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("HomePage");
  return { title: t("title"), description: t("metaDescription") };
}

// Header now comes from the root locale layout's SiteHeader, mounted
// once for every route — this page no longer renders its own.
export default function Home() {
  return (
    <div>
      <Hero />
    </div>
  );
}

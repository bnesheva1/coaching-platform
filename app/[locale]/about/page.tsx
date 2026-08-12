import type { Metadata } from "next";
import { getSiteName } from "@/lib/brand";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Link } from "@/i18n/navigation";
import { localizedAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  const siteName = await getSiteName(locale);
  return {
    title: t("metaTitle", { siteName }),
    description: t("metaDescription", { siteName }),
    alternates: localizedAlternates(locale, "/about"),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("About");
  const tHeader = await getTranslations("Header");
  const tBrowse = await getTranslations("Browse");
  const siteName = await getSiteName();

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer maxWidth={640}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-6)" }}>{t("heading", { siteName })}</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <p style={{ font: "var(--text-body-lg)", margin: 0 }}>{t("body1", { siteName })}</p>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: 0 }}>
            {t("body2")}
          </p>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: 0 }}>
            {t("body3", { siteName })}
          </p>
        </div>

        {/* Internal links per the SEO ask — a seeker landing on About
            has two obvious next steps: understand the booking flow, or
            go straight to browsing. */}
        <div style={{ marginTop: "var(--space-8)", display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <Link href="/how-it-works" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {tHeader("howItWorksLink")}
          </Link>
          <Link href="/browse" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {tBrowse("title")}
          </Link>
        </div>
      </ContentContainer>
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { localizedAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HowItWorks" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/how-it-works"),
  };
}

// Fully server-rendered — plain content, no interactivity, so no reason
// for a Client Component boundary anywhere on this page.
export default async function HowItWorksPage() {
  const t = await getTranslations("HowItWorks");

  const steps = [
    { title: t("step1Title"), body: t("step1Body") },
    { title: t("step2Title"), body: t("step2Body") },
    { title: t("step3Title"), body: t("step3Body") },
  ];

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer>
        <div style={{ maxWidth: 640, marginBottom: "var(--space-10)" }}>
          <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-3)" }}>{t("heading")}</h1>
          <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: 0 }}>{t("subheading")}</p>
        </div>

        {/* auto-fit/minmax reflows to a single column on narrow
            viewports with no media query/JS needed — the standard
            trick for a simple, evenly-sized card row like this. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--space-5)",
          }}
        >
          {steps.map((step) => (
            <Card key={step.title} title={step.title} description={step.body} />
          ))}
        </div>

        <div style={{ marginTop: "var(--space-10)", display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <p style={{ font: "var(--text-heading-sm)", margin: 0 }}>{t("ctaQuestion")}</p>
          <Button href="/browse">{t("ctaButton")}</Button>
        </div>
      </ContentContainer>
    </main>
  );
}

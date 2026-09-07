import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Image as ImageIcon } from "lucide-react";
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
    { title: t("step4Title"), body: t("step4Body") },
    { title: t("step5Title"), body: t("step5Body") },
  ];

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer>
        <div style={{ maxWidth: 680, marginBottom: "var(--space-10)" }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>{t("heading")}</h1>
          <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: 0 }}>{t("intro")}</p>
        </div>

        {/* auto-fit/minmax reflows to fewer columns on narrow viewports with no
            media query; maxWidth caps it at 3 columns on wide screens. The five
            steps plus the image-placeholder fill a clean 3x2 grid. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--space-5)",
            maxWidth: 860,
          }}
        >
          {steps.map((step) => (
            <Card key={step.title} title={step.title} description={step.body} />
          ))}
          {/* Sixth cell: an image placeholder (no artwork yet) matching the card
              frame; stretches to the row height. Decorative → aria-hidden. */}
          <div
            aria-hidden="true"
            style={{
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-surface-2)",
              boxShadow: "var(--shadow-md)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 180,
              color: "var(--text-tertiary)",
            }}
          >
            <ImageIcon size={48} strokeWidth={1.5} />
          </div>
        </div>

        {/* Credential disclaimer — a legally-relevant disclosure that must stay
            clearly visible, not tucked away. Set off with a top rule and its own
            heading so it reads as a distinct, important section. */}
        <section
          style={{
            marginTop: "var(--space-10)",
            paddingTop: "var(--space-8)",
            borderTop: "1px solid var(--border-subtle)",
            maxWidth: 680,
          }}
        >
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-3)" }}>
            {t("disclaimerHeading")}
          </h2>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-primary)", margin: 0 }}>{t("disclaimerBody")}</p>
        </section>

        <div style={{ marginTop: "var(--space-10)", display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <p style={{ font: "var(--text-heading-sm)", margin: 0 }}>{t("ctaQuestion")}</p>
          <Button href="/browse">{t("ctaButton")}</Button>
        </div>
      </ContentContainer>
    </main>
  );
}

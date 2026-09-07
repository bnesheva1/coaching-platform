import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Image as ImageIcon } from "lucide-react";
import { localizedAlternates } from "@/lib/seo";
import { DOMAIN_PILLS } from "@/lib/homepage-modalities";
import { landingPathForKey } from "@/lib/taxonomy";

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

  // Each domain name in the "areas" sentence links to /browse pre-filtered by that
  // domain's specialties — the same active-domain mapping (DOMAIN_PILLS) the homepage
  // uses; /browse OR-combines the repeated ?specialty= params.
  const domainHref = (key: string) =>
    DOMAIN_PILLS.find((d) => d.key === key)?.landingPath ?? "/browse";

  const faqs = [1, 2, 3].map((n) => ({
    question: t(`faqQ${n}` as "faqQ1"),
    answer: t(`faqA${n}` as "faqA1"),
  }));

  // FAQPage structured data — same shape and defensive `</` escaping as /faq, built
  // from the exact faqs[] rendered below (one source of truth, can't drift).
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  const faqJsonLdScript = JSON.stringify(faqJsonLd).replace(/</g, "\\u003c");

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLdScript }} />
      <ContentContainer>
        <div style={{ maxWidth: 680, marginBottom: "var(--space-10)" }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>{t("heading")}</h1>
          <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: "0 0 var(--space-4)" }}>{t("intro")}</p>
          {/* Domain names link to /browse pre-filtered by that domain — inline text
              links, not chips. */}
          <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: 0 }}>
            {t.rich("areas", {
              psychology: (chunks) => (
                // Points at the dedicated /psiholog landing page when it exists
                // (the domain's flagship specialty), else the domain browse filter.
                <Link href={landingPathForKey("psychologist") ?? domainHref("psychology")} style={{ color: "var(--accent)" }}>
                  {chunks}
                </Link>
              ),
              intuitive: (chunks) => (
                <Link href={domainHref("intuitive_practices")} style={{ color: "var(--accent)" }}>
                  {chunks}
                </Link>
              ),
              coaching: (chunks) => (
                <Link href={domainHref("coaching")} style={{ color: "var(--accent)" }}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
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

        {/* Client-facing FAQ — practical questions, reusing the FAQPage <details>
            markup + JSON-LD pattern from /faq. */}
        <section style={{ marginTop: "var(--space-12)", maxWidth: 720 }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-5)" }}>
            {t("faqHeading")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {faqs.map((item) => (
              <details
                key={item.question}
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-4) var(--space-5)",
                  background: "var(--bg-surface)",
                }}
              >
                <summary style={{ font: "var(--text-heading-sm)", cursor: "pointer" }}>{item.question}</summary>
                <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "var(--space-3) 0 0" }}>
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

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

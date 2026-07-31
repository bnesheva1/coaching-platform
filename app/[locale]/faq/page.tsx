import type { Metadata } from "next";
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
  const t = await getTranslations({ locale, namespace: "FAQ" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/faq"),
  };
}

export default async function FAQPage() {
  const t = await getTranslations("FAQ");
  const tBrowse = await getTranslations("Browse");

  const qa = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    question: t(`q${n}` as "q1"),
    answer: t(`a${n}` as "a1"),
  }));

  // FAQPage structured data — https://schema.org/FAQPage, the shape
  // Google's rich-results docs ask for. Built from the exact same qa[]
  // rendered below (one source of truth, can't drift). `</` is escaped
  // defensively so a literal "</script>" inside any answer text (none
  // today, but this is translator-editable copy, not a static literal)
  // can't prematurely close the script tag it's embedded in.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
  const jsonLdScript = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
      <ContentContainer maxWidth={720}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-8)" }}>{t("heading")}</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {qa.map((item) => (
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

        <p style={{ font: "var(--text-body-md)", margin: "var(--space-8) 0 0" }}>
          {t.rich("contactPrompt", {
            contact: (chunks) => (
              <Link href="/contact" style={{ color: "var(--accent)" }}>
                {chunks}
              </Link>
            ),
          })}
        </p>

        <p style={{ margin: "var(--space-2) 0 0" }}>
          <Link href="/browse" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {tBrowse("title")}
          </Link>
        </p>
      </ContentContainer>
    </main>
  );
}

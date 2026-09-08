import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { isDeliveryTypeEnabled } from "@/lib/delivery";
import kit from "@/components/brand-two-pages/kit.module.css";
import { ImageSlot, InkButton, FaqAccordion, type FaqItem } from "@/components/brand-two-pages/kit";
import { Calendar, CreditCard, CircleX, Laptop, Lock, User, Users, MessageCircle } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "FAQ" });
  const siteName = await getSiteName(locale);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: localizedAlternates(locale, "/vaprosi"),
    ...socialMetadata({ title, description, siteName, locale }),
  };
}

export default async function FAQPage() {
  const t = await getTranslations("FAQ");
  const tBrowse = await getTranslations("Browse");

  // a7 ("in person or online?") is gated on the same per-deployment config as
  // the rest of the in-person UI (lib/delivery.ts). In-person disabled (the
  // default, ENABLED_DELIVERY_TYPES unset) → the "everything is online" answer;
  // enabled → the original "depends on the specialist/service" answer. The
  // JSON-LD below is built from this same qa[], so it flips in lockstep.
  const inPersonEnabled = isDeliveryTypeEnabled("in_person");
  const qa = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    question: t(`q${n}` as "q1"),
    answer: n === 7 && !inPersonEnabled ? t("a7Online") : t(`a${n}` as "a1"),
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

  // ── Brand two: handoff 1k. Presentation restructure only — the same 7 Q&A,
  // regrouped into two panels; the JSON-LD above (built from qa[] in original
  // order) is untouched. Warm keeps its flat list below. ──────────────────────
  if (resolveBrand() === "two") {
    const answerFor = (n: number) => (n === 7 && !inPersonEnabled ? t("a7Online") : t(`a${n}` as "a1"));
    const group1: FaqItem[] = [
      { Icon: Calendar, question: t("q1"), answer: answerFor(1) },
      { Icon: CreditCard, question: t("q2"), answer: answerFor(2) },
      { Icon: CircleX, question: t("q3"), answer: answerFor(3) },
      { Icon: Laptop, question: t("q7"), answer: answerFor(7) },
    ];
    const group2: FaqItem[] = [
      { Icon: Lock, question: t("q4"), answer: answerFor(4) },
      { Icon: User, question: t("q5"), answer: answerFor(5) },
      { Icon: Users, question: t("q6"), answer: answerFor(6) },
    ];
    return (
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
        <ContentContainer>
          {/* Hero */}
          <div className={kit.hero}>
            <div>
              <h1 className={kit.h1}>{t("heading")}</h1>
              <p className={kit.lede}>{t.rich("heroIntro", { brand: (chunks) => <strong>{chunks}</strong> })}</p>
              <p className={kit.monoMeta}>{t("metaLine", { questions: qa.length, categories: 2 })}</p>
            </div>
            <ImageSlot label={t("heroImageLabel")} aspectRatio="4 / 3" />
          </div>

          {/* Group 01 */}
          <div className={kit.groupPanel}>
            <div className={kit.panelHead}>
              <h2 className={kit.h2}>{t("group1Title")}</h2>
              <p className={kit.panelBlurb}>{t("group1Blurb")}</p>
            </div>
            <FaqAccordion items={group1} />
          </div>

          {/* Group 02 */}
          <div className={kit.groupPanel}>
            <div className={kit.panelHead}>
              <h2 className={kit.h2}>{t("group2Title")}</h2>
              <p className={kit.panelBlurb}>{t("group2Blurb")}</p>
            </div>
            <FaqAccordion items={group2} />
          </div>

          {/* Fallback row */}
          <div className={kit.fallbackRow}>
            <span className={kit.fallbackText}>
              <MessageCircle size={40} strokeWidth={1.6} aria-hidden="true" />
              {t.rich("contactPrompt", { contact: (chunks) => <Link href="/kontakti">{chunks}</Link> })}
            </span>
            <InkButton href="/browse">{tBrowse("title")}</InkButton>
          </div>
        </ContentContainer>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
      <ContentContainer>
        {/* Match /how-it-works: default (wide) container, content left-aligned in a
            720 column (same width as /how-it-works' FAQ section). Same H1 style
            as /how-it-works (700/2rem/--font-ui). */}
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>{t("heading")}</h1>

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
              <Link href="/kontakti" style={{ color: "var(--accent)" }}>
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
        </div>
      </ContentContainer>
    </main>
  );
}

import type { Metadata } from "next";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { getLocale, getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { DOMAIN_PILLS, joinDomainLabels } from "@/lib/homepage-modalities";
import kit from "@/components/brand-two-pages/kit.module.css";
import { Eyebrow, InkButton, ImageSlot, CheckChips, FeatureCards, ConnectedSteps, QuoteBand, SectionBand, type FeatureItem, type ConnectedStepItem } from "@/components/brand-two-pages/kit";
import { Contact, CalendarCheck, Lock, Users, SlidersHorizontal } from "lucide-react";

type Loc = "bg" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "BecomePractitioner" });
  const siteName = await getSiteName(locale);
  const title = t("metaTitle", { siteName });
  // A meta tag can't carry links, so join the same active-domain labels into a
  // plain-text list for {domains} (stays in sync with data/domains.json).
  const domains = joinDomainLabels(
    DOMAIN_PILLS.map((d) => d.label[locale as Loc]),
    locale as Loc,
  );
  const description = t("metaDescription", { siteName, domains });
  return {
    title,
    description,
    alternates: localizedAlternates(locale, "/stani-specialist"),
    ...socialMetadata({ title, description, siteName, locale }),
  };
}

export default async function BecomePractitionerPage() {
  const t = await getTranslations("BecomePractitioner");
  const siteName = await getSiteName();
  const locale = (await getLocale()) as Loc;
  const conjunction = locale === "bg" ? "и" : "and";

  // ── Brand two: handoff 1i. Distinct copy under BecomePractitioner.two;
  // reuses trustNote (quote), closingQuestion/closingBody + approvalNote (the
  // two trust blocks) and ctaButton. Warm layout kept below. ──────────────────
  if (resolveBrand() === "two") {
    const benefitCards: FeatureItem[] = [
      { Icon: Contact, title: t("two.b1Title"), body: t("two.b1Body") },
      { Icon: CalendarCheck, title: t("two.b2Title"), body: t("two.b2Body") },
      { Icon: Lock, title: t("two.b3Title"), body: t("two.b3Body") },
      { Icon: Users, title: t("two.b4Title"), body: t("two.b4Body") },
      { Icon: SlidersHorizontal, title: t("two.b5Title"), body: t("two.b5Body") },
    ];
    const steps: ConnectedStepItem[] = [
      { n: 1, title: t("two.s1Title"), body: t("two.s1Body") },
      { n: 2, title: t("two.s2Title"), body: t("two.s2Body") },
      { n: 3, title: t("two.s3Title"), body: t("two.s3Body") },
    ];
    const practices = DOMAIN_PILLS.map((d) => d.label[locale]);
    return (
      <main>
        <ContentContainer>
          {/* Hero */}
          <div className={kit.hero}>
            <div>
              <Eyebrow>{t("two.eyebrow")}</Eyebrow>
              <h1 className={kit.h1}>
                {t("two.line1")}
                <br />
                {t("two.line2")}
              </h1>
              <p className={kit.lede}>{t.rich("two.lede", { brand: (chunks) => <strong>{chunks}</strong> })}</p>
              <div className={kit.heroCtaRow}>
                <InkButton href="/signup?role=practitioner">{t("ctaButton")}</InkButton>
              </div>
              <hr className={kit.hairline} />
              <CheckChips items={[t("two.check1"), t("two.check2"), t("two.check3")]} />
            </div>
            <div>
              <ImageSlot label={t("two.heroImageLabel")} src="/hero/stani-specialist.webp" aspectRatio="4 / 3" />
              <div className={kit.practiceChips}>
                {practices.map((p) => (
                  <span key={p} className={kit.practiceChip}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Benefits */}
          <section style={{ marginTop: "var(--space-8)" }}>
            <Eyebrow muted>{t("two.benefitsEyebrow")}</Eyebrow>
            <h2 className={kit.h2}>{t("two.benefitsTitle")}</h2>
            <p className={kit.sectionIntro}>{t("two.benefitsIntro")}</p>
            <FeatureCards items={benefitCards} />
          </section>
        </ContentContainer>

        {/* Quote band (full-bleed) */}
        <QuoteBand quote={t("trustNote")} attribution={siteName} />

        <ContentContainer>
          {/* How it works — connected-circle steps */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <Eyebrow muted>{t("two.stepsEyebrow")}</Eyebrow>
            <h2 className={kit.h2}>{t("two.stepsTitle")}</h2>
            <p className={kit.sectionIntro}>{t("two.stepsIntro")}</p>
            <ConnectedSteps steps={steps} />
          </section>

          {/* Two-block trust pair */}
          <div className={kit.trustPair}>
            <div>
              <p className={kit.trustBlockTitle}>{t("closingQuestion")}</p>
              <p className={kit.trustBlockBody}>{t("closingBody")}</p>
            </div>
            <div>
              <p className={kit.trustBlockTitle}>{t("two.trustBlock2Title")}</p>
              <p className={kit.trustBlockBody}>{t("approvalNote")}</p>
            </div>
          </div>
        </ContentContainer>

        {/* Closing CTA band (full-bleed, no eyebrow) */}
        <SectionBand
          heading={t("two.ctaBandTitle")}
          body={t("two.ctaBandBody")}
          ctaHref="/signup?role=practitioner"
          ctaLabel={t("ctaButton")}
          imageLabel={t("two.ctaBandImageLabel")}
        />
      </main>
    );
  }

  const benefits = [
    { title: t("benefit1Title"), body: t("benefit1Body") },
    { title: t("benefit2Title"), body: t("benefit2Body") },
    { title: t("benefit3Title"), body: t("benefit3Body") },
    { title: t("benefit4Title"), body: t("benefit4Body") },
    { title: t("benefit5Title"), body: t("benefit5Body") },
  ];

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer>
        {/* Match /how-it-works: default (wide) container, content left-aligned in a
            ~680 reading column. Same H1 style as /how-it-works (700/2rem/--font-ui). */}
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>{t("heading")}</h1>
        <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("subheading")}
        </p>

        <p style={{ font: "var(--text-body-md)", margin: "0 0 var(--space-4)" }}>
          {t.rich("introBody", {
            siteName,
            // Inject the active-domain inline links (text + href from DOMAIN_PILLS)
            // into the <domains/> slot — same pattern as /about and /how-it-works.
            domains: () =>
              DOMAIN_PILLS.flatMap((d, i) => {
                const link = (
                  <Link key={d.key} href={d.landingPath} style={{ color: "var(--accent)" }}>
                    {d.label[locale]}
                  </Link>
                );
                if (i === 0) return [link];
                const separator = i === DOMAIN_PILLS.length - 1 ? ` ${conjunction} ` : ", ";
                return [separator, link];
              }),
          })}
        </p>
        <p style={{ font: "var(--text-body-md)", margin: "0 0 var(--space-8)" }}>
          {t("pitchIntro")} <strong>{t("pitchBold", { siteName })}</strong>
        </p>

        <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-4)" }}>{t("benefitsHeading")}</h2>
        <ul style={{ margin: "0 0 var(--space-8)", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {benefits.map((b) => (
            <li key={b.title}>
              <p style={{ margin: "0 0 var(--space-1)", font: "var(--text-body-md)", fontWeight: 700 }}>{b.title}</p>
              <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{b.body}</p>
            </li>
          ))}
        </ul>

        <p
          style={{
            font: "var(--text-body-md)",
            fontStyle: "italic",
            color: "var(--text-secondary)",
            borderLeft: "2px solid var(--accent)",
            padding: "var(--space-1) 0 var(--space-1) var(--space-4)",
            margin: "0 0 var(--space-8)",
          }}
        >
          {t("trustNote")}
        </p>

        <p style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-1)" }}>{t("closingQuestion")}</p>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("closingBody")}
        </p>

        <Button href="/signup?role=practitioner" size="lg">
          {t("ctaButton")}
        </Button>
        {/* Sets applicants' expectation that a team review precedes visibility —
            the practitioner-facing side of the client credential disclaimer. */}
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)", margin: "var(--space-4) 0 0" }}>
          {t("approvalNote")}
        </p>
        </div>
      </ContentContainer>
    </main>
  );
}

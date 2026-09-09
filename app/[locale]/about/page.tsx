import type { Metadata } from "next";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { getLocale, getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, socialMetadata, SITE_URL } from "@/lib/seo";
import { DOMAIN_PILLS, joinDomainLabels } from "@/lib/homepage-modalities";
import kit from "@/components/brand-two-pages/kit.module.css";
import { ImageSlot, InkButton, FeatureCards, type FeatureItem } from "@/components/brand-two-pages/kit";
import { User, Lock, Heart, Users, BarChart3 } from "lucide-react";

type Loc = "bg" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
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
    alternates: localizedAlternates(locale, "/about"),
    ...socialMetadata({ title, description, siteName, locale }),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("About");
  const tHeader = await getTranslations("Header");
  const tBrowse = await getTranslations("Browse");
  const siteName = await getSiteName();
  const locale = (await getLocale()) as Loc;
  const conjunction = locale === "bg" ? "и" : "and";

  // Reused across branches: the DOMAIN_PILLS inline links for body2.
  const domainLinks = () =>
    DOMAIN_PILLS.flatMap((d, i) => {
      const link = (
        <Link key={d.key} href={d.landingPath} style={{ color: "var(--accent)" }}>
          {d.label[locale]}
        </Link>
      );
      if (i === 0) return [link];
      const separator = i === DOMAIN_PILLS.length - 1 ? ` ${conjunction} ` : ", ";
      return [separator, link];
    });

  // ── Brand two: handoff 1n. An EXPANSION — the hero copy (incl. DOMAIN_PILLS
  // links) is kept verbatim, now paired with an image slot, plus four new ти
  // sections + AboutPage JSON-LD. The "Защо създадохме" empty slot is omitted
  // (kept out of the DOM until Bo supplies copy — do not ship a placeholder).
  // Warm layout kept below the branch. ────────────────────────────────────────
  if (resolveBrand() === "two") {
    const trust: FeatureItem[] = [
      { Icon: User, title: t("trust1Title"), body: t("trust1Body") },
      { Icon: Lock, title: t("trust2Title"), body: t("trust2Body") },
      { Icon: Heart, title: t("trust3Title"), body: t("trust3Body") },
    ];
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: siteName, url: SITE_URL },
        {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          url: SITE_URL,
          name: siteName,
          publisher: { "@id": `${SITE_URL}/#organization` },
          inLanguage: "bg-BG",
        },
        {
          "@type": "AboutPage",
          "@id": `${SITE_URL}/about#webpage`,
          url: `${SITE_URL}/about`,
          name: t("heading", { siteName }),
          isPartOf: { "@id": `${SITE_URL}/#website` },
          about: { "@id": `${SITE_URL}/#organization` },
          inLanguage: "bg-BG",
        },
      ],
    };
    const jsonLdScript = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
    const linkStyle = { font: "var(--text-label)", color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px" } as const;

    return (
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript }} />
        <ContentContainer>
          {/* Hero — existing copy kept verbatim, now beside an image slot */}
          <div className={kit.hero} style={{ alignItems: "center" }}>
            <div style={{ maxWidth: 540 }}>
              <h1 className={kit.h1}>{t("heading", { siteName })}</h1>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <p className={kit.lede}>{t("body1", { siteName })}</p>
                <p className={kit.body}>{t.rich("body2", { domains: domainLinks })}</p>
                <p className={kit.body}>{t("body3", { siteName })}</p>
              </div>
              <hr className={kit.hairline} />
              <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap" }}>
                <Link href="/kak-raboti" style={linkStyle}>
                  {tHeader("howItWorksLink")}
                </Link>
                <Link href="/browse" style={linkStyle}>
                  {tBrowse("title")}
                </Link>
              </div>
            </div>
            <ImageSlot label={t("heroImageLabel")} aspectRatio="4 / 3" />
          </div>
        </ContentContainer>

        {/* За кого е — the one full-bleed band */}
        <section className={kit.band}>
          <ContentContainer>
            <h2 className={kit.h2}>{t("forWhomTitle", { siteName })}</h2>
            <p className={kit.body} style={{ maxWidth: 780 }}>
              {t("forWhomBody")}
            </p>
          </ContentContainer>
        </section>

        <ContentContainer>
          {/* Как гарантираме доверие — intro + 3 mini-cards */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <h2 className={kit.h2}>{t("trustTitle")}</h2>
            <p className={kit.sectionIntro} style={{ maxWidth: 720 }}>
              {t("trustIntro", { siteName })}
            </p>
            <FeatureCards items={trust} />
          </section>

          {/* Two-sided CTA */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <div className={kit.ctaCardGrid}>
              <div className={kit.ctaCard}>
                <Users className={kit.ctaCardIcon} size={40} strokeWidth={1.6} aria-hidden="true" />
                <h3 className={kit.ctaCardTitle}>{t("cta1Title")}</h3>
                <p className={kit.ctaCardBody}>{t("cta1Body")}</p>
                <InkButton href="/browse">{t("cta1Button")}</InkButton>
              </div>
              <div className={kit.ctaCard}>
                <BarChart3 className={kit.ctaCardIcon} size={40} strokeWidth={1.6} aria-hidden="true" />
                <h3 className={kit.ctaCardTitle}>{t("cta2Title")}</h3>
                <p className={kit.ctaCardBody}>{t("cta2Body")}</p>
                <InkButton href="/stanete-specialist">{t("cta2Button")}</InkButton>
              </div>
            </div>
          </section>
        </ContentContainer>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer>
        {/* Match /how-it-works: default (wide) container with the content left-
            aligned in a ~680 reading column (this inner cap), not a centered
            narrow box. Same H1 style as /how-it-works (700/2rem/--font-ui). */}
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>{t("heading", { siteName })}</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <p style={{ font: "var(--text-body-lg)", margin: 0 }}>{t("body1", { siteName })}</p>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: 0 }}>
            {t.rich("body2", {
              // Inject the active-domain inline links (text + href from DOMAIN_PILLS)
              // into the <domains/> slot — same DOMAIN_PILLS-sourced pattern as
              // /how-it-works, joined naturally with commas + the locale conjunction.
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
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: 0 }}>
            {t("body3", { siteName })}
          </p>
        </div>

        {/* Internal links per the SEO ask — a seeker landing on About
            has two obvious next steps: understand the booking flow, or
            go straight to browsing. */}
        <div style={{ marginTop: "var(--space-8)", display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <Link href="/kak-raboti" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {tHeader("howItWorksLink")}
          </Link>
          <Link href="/browse" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {tBrowse("title")}
          </Link>
        </div>
        </div>
      </ContentContainer>
    </main>
  );
}

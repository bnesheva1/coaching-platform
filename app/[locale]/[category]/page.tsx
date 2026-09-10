import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { PractitionerCard, type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { BrowseCardTwo, type BrowseCardTwoData } from "@/components/browse/BrowseCardTwo";
import { landingEntryBySlug, type LandingEntry } from "@/lib/taxonomy";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { searchPractitioners, type PractitionerSearchResult } from "@/lib/practitioners/search";
import { getSpecialtyState } from "@/lib/specialties/availability";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";
import domainsData from "@/data/domains.json";
import kit from "@/components/brand-two-pages/kit.module.css";
import { Eyebrow, InkButton, StepCards, FaqAccordion, TrustCard, type StepItem, type FaqItem } from "@/components/brand-two-pages/kit";
import { User, Calendar, CreditCard, Video, Star, Laptop, Lock, Award, Clock, MessageCircle } from "lucide-react";

// Render author copy with the {siteName} token bolded (kept white-label —
// bolds whatever the deployment's name is). Used for the brand-two hero lede.
function withSiteNameBold(text: string, siteName: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split("{siteName}").forEach((part, i) => {
    if (i > 0) nodes.push(<strong key={`b${i}`}>{siteName}</strong>);
    nodes.push(part);
  });
  return nodes;
}

// Category (taxonomy) landing pages — one dynamic route serving every
// specialty/topic slug that has a fully-authored `landing` block in the
// taxonomy data (data/specialties.json, data/topics.json). A static sibling
// route (browse, about, p, …) always wins; this catches the remaining
// single-segment paths and 404s anything that isn't a real category. Fully
// server-rendered so it's genuinely indexable, unlike Browse's client-side
// filter state.

type Loc = "bg" | "en";

// Author copy may reference the deployment's name via {siteName} (kept out of
// the JSON so the pages stay white-label). Resolved at render, not build.
function withSiteName(text: string, siteName: string): string {
  return text.replace(/\{siteName\}/g, siteName);
}

// Bookable practitioners for a category, reusing searchPractitioners with a
// fixed filter. Specialties filter in the RPC; topics filter on the returned
// rows (the RPC has no topic parameter, but every row carries its topics).
async function matchesFor(entry: LandingEntry): Promise<PractitionerSearchResult[]> {
  if (entry.kind === "specialty") {
    return searchPractitioners({ specialtyKeys: [entry.key], onlyBookable: true });
  }
  const all = await searchPractitioners({ onlyBookable: true });
  return all.filter((p) => p.topics.includes(entry.key));
}

// "active" (≥1 bookable practitioner) landing pages render normally and stay
// indexed; hidden/coming_soon ones keep their URL (no 404 — preserves any SEO
// value already earned) but get noindex + the page's existing empty "check back
// soon" state. For a specialty this reuses the roster classifier; a topic page
// is active iff it currently has bookable matches.
async function isEntryActive(entry: LandingEntry): Promise<boolean> {
  if (entry.kind === "specialty") return (await getSpecialtyState(entry.key)) === "active";
  return (await matchesFor(entry)).length > 0;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale, category } = await params;
  const entry = landingEntryBySlug(category);
  if (!entry) return {};
  const siteName = await getSiteName(locale);
  const title = withSiteName(entry.metaTitle[locale as Loc], siteName);
  const description = withSiteName(entry.metaDescription[locale as Loc], siteName);
  const active = await isEntryActive(entry);
  return {
    title,
    description,
    // Its OWN canonical + hreflang — deliberately NOT consolidated into /browse
    // the way filtered browse states are. These pages existing as their own
    // canonical URLs is the entire point.
    alternates: localizedAlternates(locale, `/${entry.slug}`),
    ...socialMetadata({ title, description, siteName, locale }),
    // Don't let a not-yet-available category get (or keep) indexed; keep follow
    // so internal links are still crawled. Active pages stay fully indexable.
    ...(active ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function CategoryLandingPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const locale = (await getLocale()) as Loc;
  const entry = landingEntryBySlug(category);
  if (!entry) notFound();

  const [matches, t, tHow, tServices, siteName] = await Promise.all([
    matchesFor(entry),
    getTranslations("Taxonomy"),
    getTranslations("HowItWorks"),
    getTranslations("Services"),
    getSiteName(),
  ]);

  const specialtyLabelByKey = new Map(
    (specialtiesData as { key: string; en: string; bg: string }[]).map((s) => [s.key, s[locale] ?? s.en]),
  );
  const topicLabelByKey = new Map(
    (topicsData as { key: string; en: string; bg: string }[]).map((tp) => [tp.key, tp[locale] ?? tp.en]),
  );
  const deliveryLabel = (dt: "online" | "in_person" | "phone") =>
    dt === "online" ? tServices("deliveryTypeOnline") : dt === "in_person" ? tServices("deliveryTypeInPerson") : tServices("deliveryTypePhone");

  const cards: PractitionerCardData[] = matches.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    specialtyLabels: p.specialties.map((k) => specialtyLabelByKey.get(k) ?? k),
    topicLabels: p.topics.map((k) => topicLabelByKey.get(k) ?? k),
    deliveryTypeLabels: p.deliveryTypes.map(deliveryLabel),
    averageRating: p.averageRating,
    reviewCount: p.reviewCount,
    location: p.location,
    availableNow: p.availableNow,
  }));

  // Condensed how-it-works recap — reuses the five step TITLES already authored
  // for /how-it-works (one source of truth) and links out to the full page.
  // ти step titles (HowItWorks.two.*, no "N." prefix) so the recap matches the
  // taxonomy pages' informal voice; warm's вие step titles stay for /kak-raboti.
  const stepTitles = [
    tHow("two.step1Title"),
    tHow("two.step2Title"),
    tHow("two.step3Title"),
    tHow("two.step4Title"),
    tHow("two.step5Title"),
  ];

  // FAQPage structured data — same shape and defensive `</` escaping as /faq and
  // /how-it-works, built from the exact FAQ rendered below (one source of truth).
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entry.faq.map((item) => ({
      "@type": "Question",
      name: item.q[locale],
      acceptedAnswer: { "@type": "Answer", text: item.a[locale] },
    })),
  };
  const faqJsonLdScript = JSON.stringify(faqJsonLd).replace(/</g, "\\u003c");

  // ── Brand two: handoff 1m — the specialty landing template. One brand-branch
  // here dresses EVERY taxonomy page (psiholog + future taro/astrolog/…) in the
  // brand-two design. Warm keeps the original layout below. ───────────────────
  if (resolveBrand() === "two") {
    // Eyebrow = the specialty's active DOMAIN label (e.g. "Психология"), falling
    // back to the specialty's own label.
    const domain = (domainsData as { key: string; bg: string; en: string; active: boolean; specialties: string[] }[]).find(
      (d) => d.active && d.specialties.includes(entry.key),
    );
    const eyebrow = domain ? (locale === "en" ? domain.en : domain.bg) : entry.label[locale];

    const stepCards: StepItem[] = [
      { n: 1, Icon: User, title: t("step1Title"), body: t("step1Body") },
      { n: 2, Icon: Calendar, title: t("step2Title"), body: t("step2Body") },
      { n: 3, Icon: CreditCard, title: t("step3Title"), body: t("step3Body") },
      { n: 4, Icon: Video, title: t("step4Title"), body: t("step4Body") },
      { n: 5, Icon: Star, title: t("step5Title"), body: t("step5Body") },
    ];
    // Positional icons for the FAQ rows (fits the authored psychologist FAQ:
    // effectiveness / tech / privacy / credentials). Extra rows fall back.
    const faqIcons = [Video, Laptop, Lock, Award];
    const faqItems: FaqItem[] = entry.faq.map((item, i) => ({
      Icon: faqIcons[i] ?? MessageCircle,
      question: item.q[locale],
      answer: item.a[locale],
    }));
    const twoCards: BrowseCardTwoData[] = matches.map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      averageRating: p.averageRating,
      reviewCount: p.reviewCount,
      specialtyLabels: p.specialties.map((k) => specialtyLabelByKey.get(k) ?? k),
      availableNow: p.availableNow,
    }));

    return (
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLdScript }} />
        <ContentContainer>
          {/* Hero — single column (no image) */}
          <div style={{ padding: "var(--space-12) 0 var(--space-8)", maxWidth: "65ch" }}>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className={kit.h1}>{entry.h1[locale]}</h1>
            <p className={kit.lede}>{withSiteNameBold(entry.intro[locale], siteName)}</p>
            <hr className={kit.hairline} />
            <div className={kit.heroMeta}>
              <span className={kit.heroMetaItem}>
                <Clock size={18} strokeWidth={1.7} aria-hidden="true" /> {t("onlineMeta")}
              </span>
              <span className={kit.heroMetaCount}>{t("specialistCount", { count: matches.length })}</span>
            </div>
          </div>

          {/* Why online */}
          <section style={{ maxWidth: "65ch", marginTop: "var(--space-8)" }}>
            <h2 className={kit.h2}>{entry.whyOnlineHeading[locale]}</h2>
            <p className={kit.body}>{withSiteName(entry.whyOnlineBody[locale], siteName)}</p>
          </section>

          {/* How it works — card steps + link to the full page */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <div className={kit.sectionHeadRow}>
              <div>
                <h2 className={kit.h2} style={{ marginBottom: "var(--space-2)" }}>
                  {t("howItWorksHeading")}
                </h2>
                <p className={kit.body} style={{ maxWidth: "50ch" }}>
                  {t("stepsIntro")}
                </p>
              </div>
              <Link href="/kak-raboti" className={kit.faqCtaLink}>
                {t("howItWorksCta")} →
              </Link>
            </div>
            <StepCards steps={stepCards} columns={5} />
          </section>

          {/* Specialists grid (sparse-safe) */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <h2 className={kit.h2}>{t("specialistsHeading")}</h2>
            <p className={kit.sectionIntro}>{t("specialistsIntro")}</p>
            {twoCards.length === 0 ? (
              <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xl)", padding: "var(--space-6)", maxWidth: "65ch" }}>
                <p className={kit.body} style={{ margin: "0 0 var(--space-4)" }}>{t("emptyBody", { category: entry.label[locale] })}</p>
                <InkButton href="/browse">{t("browseAll")}</InkButton>
              </div>
            ) : (
              <div className={kit.sparseGrid}>
                {twoCards.map((c) => (
                  <BrowseCardTwo key={c.id} practitioner={c} />
                ))}
              </div>
            )}
          </section>

          {/* FAQ + TrustCard row */}
          <section style={{ marginTop: "var(--space-16)" }}>
            <h2 className={kit.h2}>{t("faqHeading")}</h2>
            <div className={kit.faqRow}>
              <FaqAccordion items={faqItems} />
              <TrustCard heading={tHow("disclaimerHeading")} body={t("disclaimerBody")} ticks={[]} />
            </div>
          </section>
        </ContentContainer>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLdScript }} />
      <ContentContainer>
        {/* Intro block */}
        <div style={{ maxWidth: "65ch", marginBottom: "var(--space-10)" }}>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.2, margin: "0 0 var(--space-4)" }}>
            {entry.h1[locale]}
          </h1>
          <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: 0 }}>
            {withSiteName(entry.intro[locale], siteName)}
          </p>
        </div>

        {/* Why online */}
        <section style={{ maxWidth: "65ch", marginBottom: "var(--space-10)" }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-3)" }}>
            {entry.whyOnlineHeading[locale]}
          </h2>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-primary)", margin: 0 }}>
            {withSiteName(entry.whyOnlineBody[locale], siteName)}
          </p>
        </section>

        {/* Condensed how-it-works recap → /how-it-works */}
        <section style={{ maxWidth: "65ch", marginBottom: "var(--space-12)" }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-3)" }}>
            {t("howItWorksHeading")}
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            {stepTitles.map((title) => (
              <li key={title} style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
                {title}
              </li>
            ))}
          </ul>
          <Link href="/kak-raboti" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
            {t("howItWorksCta")} →
          </Link>
        </section>

        {/* Live grid of real, bookable practitioners in this category */}
        <section style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-5)" }}>
            {t("specialistsHeading")}
          </h2>
          {cards.length === 0 ? (
            // Never a bare page — a real empty state with a way onward.
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-6)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "var(--space-3)",
                maxWidth: "65ch",
              }}
            >
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>{t("emptyBody", { category: entry.label[locale] })}</p>
              <Button href="/browse" variant="secondary">
                {t("browseAll")}
              </Button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "var(--space-4)",
                alignContent: "start",
              }}
            >
              {cards.map((c) => (
                <PractitionerCard key={c.id} practitioner={c} />
              ))}
            </div>
          )}
        </section>

        {/* FAQ — same <details>/<summary> + FAQPage JSON-LD pattern as /faq and /how-it-works */}
        <section style={{ maxWidth: 720, marginBottom: "var(--space-12)" }}>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.25, margin: "0 0 var(--space-5)" }}>
            {t("faqHeading")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {entry.faq.map((item) => (
              <details
                key={item.q[locale]}
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-4) var(--space-5)",
                  background: "var(--bg-surface)",
                }}
              >
                <summary style={{ font: "var(--text-heading-sm)", cursor: "pointer" }}>{item.q[locale]}</summary>
                <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "var(--space-3) 0 0" }}>
                  {item.a[locale]}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Credential disclaimer — the SHORT taxonomy version (Taxonomy.disclaimerBody),
            distinct from the fuller /how-it-works disclosure (HowItWorks.disclaimerBody).
            Heading is shared with /how-it-works so the section reads consistently. */}
        <section
          style={{
            paddingTop: "var(--space-8)",
            borderTop: "1px solid var(--border-subtle)",
            maxWidth: "65ch",
          }}
        >
          <h2 style={{ fontWeight: 700, fontSize: "1.25rem", lineHeight: 1.25, margin: "0 0 var(--space-3)" }}>
            {tHow("disclaimerHeading")}
          </h2>
          <p style={{ font: "var(--text-body-md)", color: "var(--text-primary)", margin: 0 }}>{t("disclaimerBody")}</p>
        </section>
      </ContentContainer>
    </main>
  );
}

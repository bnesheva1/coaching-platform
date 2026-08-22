import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { PractitionerCard, type PractitionerCardData } from "@/components/browse/PractitionerCard";
import { Button } from "@/components/ui/Button";
import { landingEntryBySlug, type LandingEntry } from "@/lib/taxonomy";
import { localizedAlternates } from "@/lib/seo";
import { searchPractitioners, type PractitionerSearchResult } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";

// Category (taxonomy) landing pages — one dynamic route serving every
// modality and topic slug in the taxonomy (data/specialties.json,
// data/topics.json). A static sibling route (browse, about, p, …) always
// wins; this catches the remaining single-segment paths and 404s anything
// that isn't a real category. Server-rendered so it's genuinely indexable,
// unlike Browse's client-side filter state.

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale, category } = await params;
  const entry = landingEntryBySlug(category);
  if (!entry) return {};
  const t = await getTranslations({ locale, namespace: "Taxonomy" });
  const label = entry.label[locale as "bg" | "en"];
  return {
    title: t("metaTitle", { category: label }),
    description: t("metaDescription", { category: label }),
    // Its OWN canonical + hreflang — deliberately NOT consolidated into
    // /browse the way filtered browse states would be. These pages existing
    // as their own canonical URLs is the entire point.
    alternates: localizedAlternates(locale, `/${entry.slug}`),
  };
}

export default async function CategoryLandingPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const locale = (await getLocale()) as "bg" | "en";
  const entry = landingEntryBySlug(category);
  if (!entry) notFound();

  const [matches, t] = await Promise.all([matchesFor(entry), getTranslations("Taxonomy")]);
  const label = entry.label[locale];

  const specialtyLabelByKey = new Map(
    (specialtiesData as { key: string; en: string; bg: string }[]).map((s) => [s.key, s[locale] ?? s.en]),
  );
  const topicLabelByKey = new Map(
    (topicsData as { key: string; en: string; bg: string }[]).map((tp) => [tp.key, tp[locale] ?? tp.en]),
  );

  const cards: PractitionerCardData[] = matches.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    specialtyLabels: p.specialties.map((k) => specialtyLabelByKey.get(k) ?? k),
    topicLabels: p.topics.map((k) => topicLabelByKey.get(k) ?? k),
    averageRating: p.averageRating,
    reviewCount: p.reviewCount,
    location: p.location,
  }));

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <h1 style={{ font: "var(--text-display-sm)", color: "var(--text-primary)", margin: "0 0 var(--space-4)" }}>
          {t("heading", { category: label })}
        </h1>
        {/* A few sentences of real copy above the grid — the page's reason to
            rank. Authored per taxonomy entry, refined by the writer. */}
        <p style={{ maxWidth: "65ch", margin: "0 0 var(--space-8)", font: "var(--text-body-lg)", color: "var(--text-secondary)" }}>
          {entry.intro[locale]}
        </p>

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
            }}
          >
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>{t("emptyBody", { category: label })}</p>
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
      </ContentContainer>
    </main>
  );
}

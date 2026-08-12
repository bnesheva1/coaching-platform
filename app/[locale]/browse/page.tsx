import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localizedAlternates } from "@/lib/seo";
import { searchPractitioners } from "@/lib/practitioners/search";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { BrowseClient, type BrowseResult } from "./BrowseClient";
import specialtiesData from "@/data/specialties.json";
import topicsData from "@/data/topics.json";
import { isEnabled } from "@/lib/flags";

// specialty_keys is deliberately never sent to the RPC here — modality
// filtering now happens entirely client-side in BrowseClient (see its
// own comments on why: live per-option counts and instant-apply
// checkboxes without a server round trip per click). This page only
// ever fetches the SEARCH-filtered candidate set; `?specialty=` in the
// URL is read just to seed the client's initial selection.
// Distinct from the homepage's title/description, with its own canonical +
// hreflang. Canonical deliberately points at the clean /browse (no query
// params), so every filter/search combination consolidates onto one URL
// rather than spawning duplicate-content variants.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Browse" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/browse"),
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const locale = (await getLocale()) as "en" | "bg";
  const tServices = await getTranslations("Services");

  const specialtyParam = resolvedSearchParams.specialty;
  const initialSpecialties = !specialtyParam
    ? []
    : Array.isArray(specialtyParam)
      ? specialtyParam
      : [specialtyParam];
  const topicParam = resolvedSearchParams.topic;
  const initialTopics = !topicParam ? [] : Array.isArray(topicParam) ? topicParam : [topicParam];
  const deliveryTypeParam = resolvedSearchParams.deliveryType;
  const initialDeliveryTypes = !deliveryTypeParam
    ? []
    : Array.isArray(deliveryTypeParam)
      ? deliveryTypeParam
      : [deliveryTypeParam];
  const query = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";

  const practitioners = await searchPractitioners({ searchText: query });

  const results: BrowseResult[] = practitioners.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    specialtyKeys: p.specialties,
    topicKeys: p.topics,
    averageRating: p.averageRating,
    reviewCount: p.reviewCount,
    createdAt: p.createdAt,
    deliveryTypeKeys: p.deliveryTypes,
    location: p.location,
  }));

  const specialtyOptions = specialtiesData.map((s) => ({
    key: s.key,
    label: s[locale] ?? s.en,
  }));
  const topicOptions = topicsData.map((topic) => ({
    key: topic.key,
    label: topic[locale] ?? topic.en,
  }));
  // Fixed 3-value enum, not a JSON taxonomy file like specialty/topic —
  // filtered by the same flag as the service-editing radio, so a hidden
  // phone option disappears from Browse too, not just the dashboard.
  const deliveryTypeOptions = (
    (await isEnabled("showPhoneDelivery"))
      ? (["online", "in_person", "phone"] as const)
      : (["online", "in_person"] as const)
  ).map((key) => ({
    key,
    label:
      key === "online" ? tServices("deliveryTypeOnline") : key === "in_person" ? tServices("deliveryTypeInPerson") : tServices("deliveryTypePhone"),
  }));

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      {/* No maxWidth override — falls back to the site's own
          --content-max-width token (75rem / 1200px), not a one-off
          number for this page. */}
      <ContentContainer>
        <BrowseClient
          results={results}
          query={query}
          initialSpecialties={initialSpecialties}
          initialTopics={initialTopics}
          initialDeliveryTypes={initialDeliveryTypes}
          specialtyOptions={specialtyOptions}
          topicOptions={topicOptions}
          deliveryTypeOptions={deliveryTypeOptions}
        />
      </ContentContainer>
    </main>
  );
}

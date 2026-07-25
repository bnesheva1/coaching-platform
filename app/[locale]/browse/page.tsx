import { getLocale } from "next-intl/server";
import { searchPractitioners } from "@/lib/practitioners/search";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { BrowseClient, type BrowseResult } from "./BrowseClient";
import specialtiesData from "@/data/specialties.json";

// specialty_keys is deliberately never sent to the RPC here — modality
// filtering now happens entirely client-side in BrowseClient (see its
// own comments on why: live per-option counts and instant-apply
// checkboxes without a server round trip per click). This page only
// ever fetches the SEARCH-filtered candidate set; `?specialty=` in the
// URL is read just to seed the client's initial selection.
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const locale = (await getLocale()) as "en" | "bg";

  const specialtyParam = resolvedSearchParams.specialty;
  const initialSpecialties = !specialtyParam
    ? []
    : Array.isArray(specialtyParam)
      ? specialtyParam
      : [specialtyParam];
  const query = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";

  const practitioners = await searchPractitioners({ searchText: query });

  const results: BrowseResult[] = practitioners.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    specialtyKeys: p.specialties,
    averageRating: p.averageRating,
    reviewCount: p.reviewCount,
  }));

  const specialtyOptions = specialtiesData.map((s) => ({
    key: s.key,
    label: s[locale] ?? s.en,
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
          specialtyOptions={specialtyOptions}
        />
      </ContentContainer>
    </main>
  );
}

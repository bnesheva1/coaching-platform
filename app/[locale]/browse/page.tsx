import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { searchPractitioners } from "@/lib/practitioners/search";
import { PractitionerSearchInput } from "@/components/PractitionerSearchInput";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import specialtiesData from "@/data/specialties.json";

const BIO_SNIPPET_LENGTH = 140;

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const t = await getTranslations("Browse");
  const tReviews = await getTranslations("Reviews");
  const locale = (await getLocale()) as "en" | "bg";

  const specialtyParam = resolvedSearchParams.specialty;
  const selectedSpecialties = !specialtyParam
    ? []
    : Array.isArray(specialtyParam)
      ? specialtyParam
      : [specialtyParam];
  const searchText = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";

  const practitioners = await searchPractitioners({
    specialtyKeys: selectedSpecialties,
    searchText,
  });

  const specialtyLabels = new Map(
    specialtiesData.map((s) => [s.key, s[locale] ?? s.en]),
  );

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={700}>
        <h1 style={{ font: "var(--text-heading-lg)" }}>{t("title")}</h1>

        <form
          method="get"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}
        >
          <PractitionerSearchInput defaultValue={searchText} />

          <fieldset>
            <legend>{t("specialtiesLabel")}</legend>
            {specialtiesData.map((specialty) => (
              <label key={specialty.key} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  name="specialty"
                  value={specialty.key}
                  defaultChecked={selectedSpecialties.includes(specialty.key)}
                />{" "}
                {specialty[locale] ?? specialty.en}
              </label>
            ))}
          </fieldset>

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="submit">{t("filterButton")}</Button>
            <Button href="/browse" variant="ghost">{t("clearFiltersLink")}</Button>
          </div>
        </form>

        {practitioners.length === 0 ? (
          <p>{t("noResults")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            {practitioners.map((practitioner) => (
              <li key={practitioner.id} style={{ display: "flex", gap: "var(--space-4)" }}>
                {practitioner.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={practitioner.avatarUrl}
                    alt={practitioner.displayName ?? practitioner.username}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: "cover",
                      borderRadius: "50%",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div>
                  <Link href={`/p/${practitioner.username}`}>
                    <strong>{practitioner.displayName || `@${practitioner.username}`}</strong>
                  </Link>
                  {practitioner.averageRating !== null && (
                    <span style={{ marginLeft: "var(--space-2)", color: "#666", font: "var(--text-body-md)" }}>
                      ★ {practitioner.averageRating.toFixed(1)}{" "}
                      {tReviews("reviewCountBadge", { count: practitioner.reviewCount })}
                    </span>
                  )}
                  {practitioner.specialties.length > 0 && (
                    <p style={{ margin: "var(--space-1) 0", color: "#666" }}>
                      {practitioner.specialties
                        .map((key) => specialtyLabels.get(key) ?? key)
                        .join(" · ")}
                    </p>
                  )}
                  {practitioner.bio && (
                    <p style={{ margin: "var(--space-1) 0" }}>
                      {practitioner.bio.length > BIO_SNIPPET_LENGTH
                        ? `${practitioner.bio.slice(0, BIO_SNIPPET_LENGTH)}…`
                        : practitioner.bio}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ContentContainer>
    </main>
  );
}

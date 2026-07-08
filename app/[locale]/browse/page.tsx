import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { searchPractitioners } from "@/lib/practitioners/search";
import specialtiesData from "@/data/specialties.json";

const BIO_SNIPPET_LENGTH = 140;

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = await searchParams;
  const t = await getTranslations("Browse");
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
    <main style={{ maxWidth: 700, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("title")}</h1>

      <form
        method="get"
        style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}
      >
        <label>
          {t("searchLabel")}
          <br />
          <input type="text" name="q" defaultValue={searchText} />
        </label>

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

        <div>
          <button type="submit">{t("filterButton")}</button>{" "}
          <Link href="/browse">{t("clearFiltersLink")}</Link>
        </div>
      </form>

      {practitioners.length === 0 ? (
        <p>{t("noResults")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {practitioners.map((practitioner) => (
            <li key={practitioner.id} style={{ display: "flex", gap: "1rem" }}>
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
                {practitioner.specialties.length > 0 && (
                  <p style={{ margin: "0.25rem 0", color: "#666" }}>
                    {practitioner.specialties
                      .map((key) => specialtyLabels.get(key) ?? key)
                      .join(" · ")}
                  </p>
                )}
                {practitioner.bio && (
                  <p style={{ margin: "0.25rem 0" }}>
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
    </main>
  );
}

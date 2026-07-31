import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { localizedAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "BecomePractitioner" });
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const siteName = tHome("title");
  return {
    title: t("metaTitle", { siteName }),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/become-a-practitioner"),
  };
}

export default async function BecomePractitionerPage() {
  const t = await getTranslations("BecomePractitioner");
  const tHome = await getTranslations("HomePage");
  const siteName = tHome("title");

  const benefits = [
    { title: t("benefit1Title"), body: t("benefit1Body") },
    { title: t("benefit2Title"), body: t("benefit2Body") },
    { title: t("benefit3Title"), body: t("benefit3Body") },
    { title: t("benefit4Title"), body: t("benefit4Body") },
    { title: t("benefit5Title"), body: t("benefit5Body") },
  ];

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer maxWidth={720}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-2)" }}>{t("heading")}</h1>
        <p style={{ font: "var(--text-body-lg)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("subheading")}
        </p>

        <p style={{ font: "var(--text-body-md)", margin: "0 0 var(--space-4)" }}>{t("introBody")}</p>
        <p style={{ font: "var(--text-body-md)", margin: "0 0 var(--space-8)" }}>
          {t("pitchIntro")} <strong>{t("pitchBold", { siteName })}</strong>
        </p>

        <h2 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-4)" }}>{t("benefitsHeading")}</h2>
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
      </ContentContainer>
    </main>
  );
}

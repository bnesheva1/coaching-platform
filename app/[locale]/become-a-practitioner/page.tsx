import type { Metadata } from "next";
import { getSiteName } from "@/lib/brand";
import { getLocale, getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { DOMAIN_PILLS, joinDomainLabels } from "@/lib/homepage-modalities";

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
    alternates: localizedAlternates(locale, "/become-a-practitioner"),
    ...socialMetadata({ title, description, siteName, locale }),
  };
}

export default async function BecomePractitionerPage() {
  const t = await getTranslations("BecomePractitioner");
  const siteName = await getSiteName();
  const locale = (await getLocale()) as Loc;
  const conjunction = locale === "bg" ? "и" : "and";

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

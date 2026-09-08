import type { Metadata } from "next";
import { getSiteName } from "@/lib/brand";
import { getLocale, getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
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
          <Link href="/how-it-works" style={{ font: "var(--text-label)", color: "var(--accent)" }}>
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

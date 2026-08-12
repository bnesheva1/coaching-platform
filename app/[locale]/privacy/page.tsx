import type { Metadata } from "next";
import { getSiteName } from "@/lib/brand";
import { getTranslations, getLocale } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { MarkdownContent } from "@/components/content/MarkdownContent";
import { getPrivacyPolicyContent } from "@/lib/content/privacy";
import { localizedAlternates } from "@/lib/seo";

const INTL_LOCALES: Record<string, string> = { en: "en-US", bg: "bg-BG" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  const siteName = await getSiteName(locale);
  return {
    title: t("metaTitle", { siteName }),
    description: t("metaDescription", { siteName }),
    alternates: localizedAlternates(locale, "/privacy"),
  };
}

// The actual policy text lives in content/privacy-policy/{locale}.md,
// not here — see lib/content/privacy.ts's own comment for why. This
// page only owns the page shell: title, the visible "last updated"
// date (read from the content file's own frontmatter, not hardcoded),
// and the reading-width container the markdown renders inside.
export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");
  const locale = await getLocale();
  const { lastUpdated, body } = getPrivacyPolicyContent(locale);
  const formattedLastUpdated = lastUpdated
    ? new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { dateStyle: "long" }).format(new Date(lastUpdated))
    : null;

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      {/* 640, not the app's usual content width — matches About page's
          own long-form-reading container exactly, for the same reason:
          a comfortable measure for paragraphs of running text, not a
          layout meant to hold cards/grids. */}
      <ContentContainer maxWidth={640}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-2)" }}>{t("heading")}</h1>
        {formattedLastUpdated && (
          <p style={{ margin: "0 0 var(--space-6)", font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
            {t("lastUpdatedLabel", { date: formattedLastUpdated })}
          </p>
        )}
        <MarkdownContent markdown={body} />
      </ContentContainer>
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { localizedAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  const tHome = await getTranslations({ locale, namespace: "HomePage" });
  const siteName = tHome("title");
  return {
    title: t("metaTitle", { siteName }),
    description: t("metaDescription", { siteName }),
    alternates: localizedAlternates(locale, "/privacy"),
  };
}

// Content deliberately not written here — the user supplies the real
// policy text separately (data collected, retention periods, the
// Stripe-KYC-retention point, third-party processors, etc.). This is
// the route/layout/translation-namespace scaffold it'll land in: swap
// the single placeholder paragraph below for real section content
// (headings + body under the same "Privacy" namespace) when it's ready.
export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer maxWidth={720}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-6)" }}>{t("heading")}</h1>
        <div
          style={{
            padding: "var(--space-4)",
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-sunken)",
          }}
        >
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
            {t("placeholderNote")}
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { localizedAlternates } from "@/lib/seo";
import { ContactForm } from "./ContactForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/contact"),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("Contact");

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer maxWidth={480}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-2)" }}>{t("heading")}</h1>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("intro")}
        </p>
        <ContactForm />
      </ContentContainer>
    </main>
  );
}

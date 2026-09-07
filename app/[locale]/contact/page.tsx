import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { getSiteName } from "@/lib/brand";
import { ContactForm } from "./ContactForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  const siteName = await getSiteName(locale);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: localizedAlternates(locale, "/contact"),
    ...socialMetadata({ title, description, siteName, locale }),
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

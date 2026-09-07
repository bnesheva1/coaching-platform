import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("checkEmailTitle"), description: t("checkEmailBody") };
}

export default async function CheckEmailPage() {
  const t = await getTranslations("Auth");

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "var(--font-ui)" }}>
      <h1>{t("checkEmailTitle")}</h1>
      <p>{t("checkEmailBody")}</p>
    </main>
  );
}

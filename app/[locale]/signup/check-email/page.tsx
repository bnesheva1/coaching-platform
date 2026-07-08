import { getTranslations } from "next-intl/server";

export default async function CheckEmailPage() {
  const t = await getTranslations("Auth");

  return (
    <main style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>{t("checkEmailTitle")}</h1>
      <p>{t("checkEmailBody")}</p>
    </main>
  );
}

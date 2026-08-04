import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";

// Public — reached right after deleteMyAccount signs the user out, so
// there's no session left to gate this on by the time they land here.
export default async function AccountDeletedPage() {
  const t = await getTranslations("AccountDeleted");

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("title")}</h1>
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("body")}</p>
        </div>
      </ContentContainer>
    </main>
  );
}

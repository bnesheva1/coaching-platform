import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { getCookieConsent } from "@/lib/cookieConsent";
import { CookiePreferencesForm } from "./CookiePreferencesForm";

// Public — no auth required. Cookie consent is a browser-level choice,
// not an account-level one, so a logged-out visitor needs to be able to
// revisit and change it just as much as a signed-in user.
export default async function CookiePreferencesPage() {
  const t = await getTranslations("CookieConsent");
  const consent = await getCookieConsent();

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={640}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("preferencesTitle")}</h1>
          <CookiePreferencesForm initialAnalytics={consent?.analytics ?? false} updatedAt={consent?.ts ?? null} />
        </div>
      </ContentContainer>
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Link } from "@/i18n/navigation";

// Static confirmation, reached from EVERY path through requestPasswordReset
// (rate-limited aside) — whether or not the email matched a real
// account. See actions.ts's own comment for why that's deliberate.
export default async function ForgotPasswordCheckEmailPage() {
  const t = await getTranslations("Auth");

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("checkEmailTitle")}</h1>
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
            {t("resetCheckEmailBody")}
          </p>
          <p style={{ margin: 0 }}>
            <Link href="/login" style={{ color: "var(--accent)" }}>
              {t("loginTitle")}
            </Link>
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}

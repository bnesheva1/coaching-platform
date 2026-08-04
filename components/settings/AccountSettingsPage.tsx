import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { MarketingConsentSection } from "./MarketingConsentSection";
import { DeleteAccountSection } from "./DeleteAccountSection";

// Shared by both dashboards' own settings pages (practitioner-dashboard/
// settings, client-dashboard/settings) — everything here is identical
// regardless of role except displayName, which each page's own layout
// already fetched for its own header ("Здравей, {name}") and passes
// straight through rather than this component re-querying it.
export async function AccountSettingsPage({
  displayName,
  marketingConsent,
  marketingConsentUpdatedAt,
}: {
  displayName: string;
  marketingConsent: boolean;
  marketingConsentUpdatedAt: string | null;
}) {
  const t = await getTranslations("AccountSettings");
  const locale = await getLocale();

  return (
    <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("title")}</h1>

      <MarketingConsentSection initialConsent={marketingConsent} updatedAt={marketingConsentUpdatedAt} />

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          padding: "var(--space-4)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
        }}
      >
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("cookiePreferencesTitle")}</h2>
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("cookiePreferencesDescription")}
        </p>
        <Link href="/cookie-preferences" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
          {t("cookiePreferencesLink")}
        </Link>
      </section>

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          padding: "var(--space-4)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-surface)",
        }}
      >
        <h2 style={{ margin: 0, font: "var(--text-heading-sm)" }}>{t("dataExportTitle")}</h2>
        <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
          {t("dataExportDescription")}
        </p>
        {/* Plain <a>, not next-intl's Link — Link assumes it's
            client-side-navigating to a page and would try to fetch this
            as one; this route returns a raw file (Content-Disposition:
            attachment, see settings/export/route.ts), so it needs a
            real, uninterrupted browser navigation. The locale prefix is
            built in manually since Link would normally be what adds it. */}
        <a href={`/${locale}/settings/export`} style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
          {t("dataExportButton")}
        </a>
      </section>

      <DeleteAccountSection displayName={displayName} />
    </div>
  );
}

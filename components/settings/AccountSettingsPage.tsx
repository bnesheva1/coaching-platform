import type { ReactNode } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";
import { MarketingConsentSection } from "./MarketingConsentSection";
import { ChangePasswordSection } from "./ChangePasswordSection";
import { DeleteAccountSection } from "./DeleteAccountSection";

// Shared by both dashboards' own settings pages (practitioner-dashboard/
// settings, client-dashboard/settings) — everything here is identical
// regardless of role except displayName (each page's own layout already
// fetched it for its own header, "Здравей, {name}", and passes it
// straight through rather than this component re-querying it) and
// practitionerOnlyContent (username + Stripe Connect — moved here from
// the Profile tab, where Stripe in particular was easy to miss since it
// only rendered in Edit mode; the client settings page simply never
// passes this prop). Rendered first, above the identity-agnostic
// sections below, since it's the more "primary" settings for the role
// that has it.
export async function AccountSettingsPage({
  displayName,
  marketingConsent,
  marketingConsentUpdatedAt,
  practitionerOnlyContent,
  nameSection,
  timezoneSection,
}: {
  displayName: string;
  marketingConsent: boolean;
  marketingConsentUpdatedAt: string | null;
  practitionerOnlyContent?: ReactNode;
  // The client settings page passes its editable name field here (the
  // name the client's practitioners see). The practitioner page never
  // does — a practitioner edits their name on the Profile tab instead.
  nameSection?: ReactNode;
  // The client settings page passes its timezone picker here; the
  // practitioner page never does (a practitioner's timezone lives on the
  // Schedule tab, tied to their availability, not here).
  timezoneSection?: ReactNode;
}) {
  const t = await getTranslations("AccountSettings");
  const locale = await getLocale();

  return (
    <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("title")}</h1>

      {practitionerOnlyContent}

      {nameSection}

      {timezoneSection}

      <ChangePasswordSection />

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
        <a href={getPathname({ href: "/settings/export", locale })} style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
          {t("dataExportButton")}
        </a>
      </section>

      <DeleteAccountSection displayName={displayName} />
    </div>
  );
}

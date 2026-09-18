import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Non-blocking backfill prompt: shown on the practitioner dashboard when no TIN
// is on file (new signups and existing practitioners alike — we can't invent
// this data). Deliberately does NOT gate dashboard access; it flags, links to
// settings, and gets out of the way once the TIN is saved.
export async function TinNotice() {
  const t = await getTranslations("TaxId");
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        margin: "0 0 var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: "1px solid color-mix(in oklab, var(--color-warning) 40%, var(--border-default))",
        background: "color-mix(in oklab, var(--color-warning) 10%, transparent)",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong style={{ font: "var(--text-body-md)", display: "block" }}>{t("bannerTitle")}</strong>
        <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("bannerBody")}</span>
      </div>
      <Link
        href="/practitioner-dashboard/settings"
        style={{ font: "var(--text-body-sm)", fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
      >
        {t("bannerCta")}
      </Link>
    </div>
  );
}

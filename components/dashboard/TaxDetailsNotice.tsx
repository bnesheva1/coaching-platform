import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// One non-blocking backfill banner for the DAC7 tax details (TIN + IBAN). The
// body adapts to what's actually missing so a practitioner never sees two
// stacked banners. Never gates dashboard access; links to settings and clears
// once both are on file. Render only when something is missing.
export async function TaxDetailsNotice({ missingTin, missingIban }: { missingTin: boolean; missingIban: boolean }) {
  const t = await getTranslations("TaxId");
  const body = missingTin && missingIban ? t("detailsBannerBoth") : missingTin ? t("detailsBannerTin") : t("detailsBannerIban");
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
        <strong style={{ font: "var(--text-body-md)", display: "block" }}>{t("detailsBannerTitle")}</strong>
        <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{body}</span>
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

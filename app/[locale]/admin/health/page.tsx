import { Link } from "@/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { runHealthReport, type HealthStatus } from "@/lib/admin/health";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { HealthRefreshButton } from "@/components/admin/HealthRefreshButton";

// Never cached — a stale health page is worse than none. force-dynamic + no
// revalidate means every load (and every manual refresh) runs the checks live.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

const STATUS_COLOR: Record<HealthStatus, string> = {
  pass: "#1e7f4f",
  degraded: "#a15c00",
  fail: "#c0392b",
};

export default async function AdminHealthPage() {
  await requireAdmin();
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const report = await runHealthReport();

  const checkedAt = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(report.checkedAt));

  const statusLabel = (s: HealthStatus) => t(`status_${s}` as Parameters<typeof t>[0]);

  const cardStyle = {
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-1)",
  };
  const badgeStyle = (color: string) =>
    ({
      font: "var(--text-label)",
      textTransform: "uppercase" as const,
      letterSpacing: "0.06em",
      color,
      whiteSpace: "nowrap" as const,
    }) as const;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("healthHeading")}</h1>
          <Link href="/admin" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("healthBackToAdmin")}
          </Link>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
          <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
            {t("healthCheckedAt", { time: checkedAt })}
          </span>
          <HealthRefreshButton label={t("healthRefresh")} pendingLabel={t("healthRefreshing")} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {/* ── Dependencies ──────────────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-1)" }}>{t("healthDepsHeading")}</h2>
            <p style={{ margin: "0 0 var(--space-3)", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("healthDepsSub")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {report.dependencies.map((d) => (
                <div key={d.name} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                    <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{d.name}</span>
                    <span style={badgeStyle(STATUS_COLOR[d.status])}>● {statusLabel(d.status)}</span>
                  </div>
                  <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{d.detail}</span>
                  {d.error && (
                    <span
                      style={{
                        font: "var(--text-body-sm)",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "#c0392b",
                        wordBreak: "break-word",
                        marginTop: "var(--space-1)",
                      }}
                    >
                      {d.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Configuration state ───────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-1)" }}>{t("healthConfigHeading")}</h2>
            <p style={{ margin: "0 0 var(--space-3)", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("healthConfigSub")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {report.config.map((c) => (
                <div
                  key={c.name}
                  style={{
                    ...cardStyle,
                    borderLeft: c.level === "warn" ? "3px solid #a15c00" : cardStyle.border,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                    <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>{c.name}</span>
                    {c.level === "warn" && <span style={badgeStyle("#a15c00")}>{t("healthFlagged")}</span>}
                  </div>
                  <span style={{ font: "var(--text-body-md)", fontFamily: "var(--font-mono, monospace)", wordBreak: "break-word", color: c.level === "warn" ? "#a15c00" : "var(--text-primary)" }}>
                    {c.value}
                  </span>
                  {c.note && <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{c.note}</span>}
                </div>
              ))}
            </div>
          </section>

          {/* ── Cron ──────────────────────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("healthCronHeading")}</h2>
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{t("healthCronDaily")}</span>
                <span style={badgeStyle(STATUS_COLOR[report.cron.status])}>● {statusLabel(report.cron.status)}</span>
              </div>
              <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{report.cron.detail}</span>
              {report.cron.summary != null && (
                <pre
                  style={{
                    margin: "var(--space-2) 0 0",
                    padding: "var(--space-2)",
                    background: "var(--bg-sunken)",
                    borderRadius: "var(--radius-sm)",
                    font: "var(--text-body-sm)",
                    fontFamily: "var(--font-mono, monospace)",
                    overflowX: "auto",
                    color: "var(--text-secondary)",
                  }}
                >
                  {JSON.stringify(report.cron.summary, null, 2)}
                </pre>
              )}
            </div>
          </section>
        </div>
      </ContentContainer>
    </main>
  );
}

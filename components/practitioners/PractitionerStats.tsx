import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PractitionerStats as Stats } from "@/lib/practitioners/stats";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

const cardStyle = {
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-1)",
};
const valueStyle = { font: "var(--text-heading-md)", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" as const };
const labelStyle = { font: "var(--text-label)", textTransform: "uppercase" as const, letterSpacing: "0.06em", color: "var(--text-tertiary)" };
const captionStyle = { font: "var(--text-caption)", color: "var(--text-tertiary)" };
const sectionTitleStyle = { margin: "0 0 var(--space-3)", font: "var(--text-heading-sm)", color: "var(--text-primary)" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "var(--space-3)" };

function StatCard({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div style={cardStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
      {caption && <span style={captionStyle}>{caption}</span>}
    </div>
  );
}

// The funnel — the point of the page. Proportional bars (widths relative to the
// top of the funnel) make the drop-off visible at a glance; the opened→booked
// step is then called out in words, since that's the useful number.
async function Funnel({ funnel }: { funnel: Stats["funnel"] }) {
  const t = await getTranslations("Stats");
  const stages = [
    { key: "viewed", value: funnel.viewed },
    { key: "opened", value: funnel.opened },
    { key: "booked", value: funnel.booked },
    { key: "completed", value: funnel.completed },
  ] as const;
  const max = Math.max(1, ...stages.map((s) => s.value));
  const pct = funnel.opened > 0 ? Math.round((funnel.booked / funnel.opened) * 100) : null;

  return (
    <section aria-label={t("funnel.title")}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
        <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{t("funnel.title")}</h2>
        <span style={captionStyle}>{t("funnel.thisMonth")}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {stages.map((s) => (
          <div key={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 40%) 1fr auto", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t(`funnel.${s.key}`)}</span>
            <span aria-hidden="true" style={{ height: 12, background: "var(--bg-sunken)", borderRadius: "var(--radius-pill)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.max(s.value > 0 ? 4 : 0, (s.value / max) * 100)}%`, background: "var(--accent)", borderRadius: "var(--radius-pill)" }} />
            </span>
            <span style={{ ...valueStyle, font: "var(--text-body-md)", minWidth: "3ch", textAlign: "right" }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* The most useful number on the page — spelled out, not buried. */}
      <p style={{ margin: "var(--space-4) 0 0", font: "var(--text-body-md)", color: "var(--text-primary)" }}>
        {pct === null
          ? t("funnel.dropoffNoOpens")
          : t("funnel.dropoff", { opened: funnel.opened, booked: funnel.booked, pct })}
      </p>
    </section>
  );
}

// The full stats view — shared by the practitioner's own stats page and the admin
// per-practitioner page.
export async function PractitionerStats({ stats }: { stats: Stats }) {
  const t = await getTranslations("Stats");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const num = new Intl.NumberFormat(intlLocale);
  const money = new Intl.NumberFormat(intlLocale, { style: "currency", currency: stats.revenue.currency || "EUR", maximumFractionDigits: 2 });
  const fmtMoney = (cents: number) => money.format(cents / 100);

  if (!stats.hasAnyData) {
    return <EmptyState />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <Funnel funnel={stats.funnel} />

      <section>
        <h2 style={sectionTitleStyle}>{t("bookings.title")}</h2>
        <div style={gridStyle}>
          <StatCard label={t("bookings.thisMonth")} value={num.format(stats.bookings.thisMonth)} />
          <StatCard label={t("bookings.lastMonth")} value={num.format(stats.bookings.lastMonth)} />
          <StatCard label={t("bookings.allTime")} value={num.format(stats.bookings.allTime)} />
          <StatCard label={t("repeatClients.label")} value={num.format(stats.repeatClients)} caption={t("repeatClients.hint")} />
        </div>
      </section>

      <section>
        <h2 style={sectionTitleStyle}>{t("outcomes.title")}</h2>
        <div style={gridStyle}>
          <StatCard label={t("outcomes.completed")} value={num.format(stats.outcomes.completed)} />
          <StatCard label={t("outcomes.cancelledByClient")} value={num.format(stats.outcomes.cancelledByClient)} />
          <StatCard label={t("outcomes.cancelledByPractitioner")} value={num.format(stats.outcomes.cancelledByPractitioner)} />
          <StatCard label={t("outcomes.cancelledByAdmin")} value={num.format(stats.outcomes.cancelledByAdmin)} />
          <StatCard label={t("outcomes.noShow")} value={num.format(stats.outcomes.noShow)} caption={t("outcomes.noShowNote")} />
        </div>
      </section>

      <section>
        <h2 style={sectionTitleStyle}>{t("revenue.title")}</h2>
        <div style={gridStyle}>
          <StatCard label={t("revenue.gross")} value={fmtMoney(stats.revenue.grossCents)} />
          <StatCard label={t("revenue.net")} value={fmtMoney(stats.revenue.netCents)} caption={t("revenue.netHint")} />
          <StatCard label={t("revenue.refunds")} value={fmtMoney(stats.revenue.refundCents)} caption={t("revenue.refundCount", { count: stats.revenue.refundCount })} />
        </div>
      </section>

      <section>
        <h2 style={sectionTitleStyle}>{t("reviews.title")}</h2>
        <div style={gridStyle}>
          <StatCard
            label={t("reviews.average")}
            value={stats.reviews.average === null ? "—" : num.format(stats.reviews.average)}
            caption={t("reviews.count", { count: stats.reviews.count })}
          />
        </div>
      </section>
    </div>
  );
}

// The home-screen summary: the funnel + a few headline numbers + a link to the
// full page. Keeps Начало lighter than the whole dashboard.
export async function PractitionerStatsSummary({ stats }: { stats: Stats }) {
  const t = await getTranslations("Stats");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const num = new Intl.NumberFormat(intlLocale);
  const money = new Intl.NumberFormat(intlLocale, { style: "currency", currency: stats.revenue.currency || "EUR", maximumFractionDigits: 0 });

  if (!stats.hasAnyData) {
    return <EmptyState compact />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Funnel funnel={stats.funnel} />
      <div style={gridStyle}>
        <StatCard label={t("bookings.thisMonth")} value={num.format(stats.bookings.thisMonth)} />
        <StatCard label={t("revenue.net")} value={money.format(stats.revenue.netCents / 100)} caption={t("revenue.netHint")} />
        <StatCard
          label={t("reviews.average")}
          value={stats.reviews.average === null ? "—" : num.format(stats.reviews.average)}
          caption={t("reviews.count", { count: stats.reviews.count })}
        />
      </div>
      <div>
        <Link href="/practitioner-dashboard/stats" style={{ font: "var(--text-body-sm)", fontWeight: 600, color: "var(--accent)" }}>
          {t("seeAll")} →
        </Link>
      </div>
    </div>
  );
}

// New practitioner with nothing yet — explain what WILL appear and why the funnel
// is the useful part, rather than a wall of zeros.
async function EmptyState({ compact = false }: { compact?: boolean }) {
  const t = await getTranslations("Stats");
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: compact ? "var(--space-5)" : "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <span style={{ font: "var(--text-heading-sm)", color: "var(--text-primary)" }}>{t("empty.title")}</span>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)", maxWidth: "62ch" }}>{t("empty.body")}</p>
    </div>
  );
}

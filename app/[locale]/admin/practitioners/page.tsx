import { Link } from "@/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { PractitionerControls } from "@/components/admin/PractitionerControls";
import { isAnonymised } from "@/lib/deleted-user";
import { COMMISSION_RATE } from "@/lib/payments/stripe/checkout";
import { SUBSCRIPTION_PRICE_CENTS } from "@/lib/payments";

export const dynamic = "force-dynamic";

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

type Row = {
  id: string;
  username: string | null;
  display_name: string | null;
  moderation_status: "pending" | "active" | "changes_requested" | "hidden" | "bookings_frozen" | "suspended";
  payouts_frozen: boolean;
  is_bookable: boolean;
  connect_transfers_active: boolean | null;
  billing_model: string | null;
  has_connect_account: boolean;
  upcoming_count: number;
  total_sessions: number;
  average_rating: number | null;
  review_count: number;
  commission_rate_override: number | string | null;
  commission_rate_reason: string | null;
  commission_rate_set_at: string | null;
  subscription_status: "not_required" | "active" | "grace" | "lapsed" | "exempt";
  subscription_exempt: boolean;
  subscription_current_period_end: string | null;
  subscription_price_override_cents: number | null;
  subscription_override_reason: string | null;
  subscription_override_set_at: string | null;
};

export default async function AdminPractitionersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireAdmin();
  const t = await getTranslations("Admin");
  const tDeleted = await getTranslations("DeletedUser");
  const locale = await getLocale();
  const numberFmt = new Intl.NumberFormat(INTL_LOCALES[locale] ?? "en-US");
  const dateFmt = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { day: "numeric", month: "short", year: "numeric" });
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const STATUS_FILTERS = ["pending", "changes_requested", "active", "hidden", "bookings_frozen", "suspended"] as const;
  const status = (STATUS_FILTERS as readonly string[]).includes(params.status ?? "") ? params.status! : "";

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_list_practitioners", { search: q || null });
  const allRows = (data ?? []) as Row[];
  // Per-status counts across the full (search-scoped) set — drives the tab
  // counts so an admin sees at a glance how many are awaiting review / mid-revision.
  const countByStatus = new Map<string, number>();
  for (const r of allRows) countByStatus.set(r.moderation_status, (countByStatus.get(r.moderation_status) ?? 0) + 1);
  const rows = status ? allRows.filter((r) => r.moderation_status === status) : allRows;

  // A filter tab's href — preserves the current search query.
  const tabHref = (s: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s) sp.set("status", s);
    const qs = sp.toString();
    return `/admin/practitioners${qs ? `?${qs}` : ""}`;
  };

  // admin_list_practitioners doesn't carry the review reason; fetch it just for
  // the changes_requested rows so the note can be previewed inline. Display-only
  // — the review-gate flow itself is untouched.
  const changesIds = rows.filter((r) => r.moderation_status === "changes_requested").map((r) => r.id);
  const reasonById = new Map<string, string>();
  if (changesIds.length) {
    const { data: reasons } = await supabase.from("practitioner_profiles").select("id, moderation_reason").in("id", changesIds);
    for (const row of reasons ?? []) {
      if (row.moderation_reason) reasonById.set(row.id as string, row.moderation_reason as string);
    }
  }

  function connectLabel(r: Row): { text: string; warn: boolean } {
    if (r.billing_model !== "commission") return { text: t("practConnectNA"), warn: false };
    if (r.has_connect_account && r.connect_transfers_active) return { text: t("practConnectActive"), warn: false };
    if (r.has_connect_account) return { text: t("practConnectOnboarding"), warn: true };
    return { text: t("practConnectNone"), warn: true };
  }

  const cardStyle = {
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-3)",
  };
  const statStyle = { font: "var(--text-body-sm)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" as const };
  const statLabel = { font: "var(--text-label)", textTransform: "uppercase" as const, letterSpacing: "0.06em", color: "var(--text-tertiary)" };

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("practHeading")}</h1>
          <Link href="/admin" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("healthBackToAdmin")}
          </Link>
        </div>

        <form method="get" style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("practSearchPlaceholder")}
            className="form-field"
            style={{ flex: 1, maxWidth: 360 }}
          />
          {/* Keep the active status filter when searching. */}
          {status && <input type="hidden" name="status" value={status} />}
          <Button type="submit" variant="secondary" size="sm">
            {t("practSearch")}
          </Button>
        </form>

        {/* Status filter tabs, with per-status counts (across the search-scoped set). */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
          {["", ...STATUS_FILTERS].map((s) => {
            const activeTab = s === status;
            const label = s === "" ? t("filterAll") : t(`modStatus_${s}` as Parameters<typeof t>[0]);
            const count = s === "" ? allRows.length : countByStatus.get(s) ?? 0;
            return (
              <Link
                key={s || "all"}
                href={tabHref(s)}
                style={{
                  font: "var(--text-body-sm)",
                  textDecoration: "none",
                  padding: "var(--space-1) var(--space-3)",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${activeTab ? "var(--accent)" : "var(--border-default)"}`,
                  background: activeTab ? "var(--accent-subtle)" : "transparent",
                  color: activeTab ? "var(--accent-subtle-text)" : "var(--text-secondary)",
                  fontWeight: activeTab ? 600 : 400,
                }}
              >
                {label} ({numberFmt.format(count)})
              </Link>
            );
          })}
        </div>

        {error ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--color-danger)" }}>{t("practLoadError")}</p>
        ) : rows.length === 0 ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{t("practNone")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {rows.map((r) => {
              const connect = connectLabel(r);
              const rating = r.average_rating != null ? `${r.average_rating.toFixed(1)} (${numberFmt.format(r.review_count)})` : "—";
              const rDeleted = isAnonymised(r.display_name);
              return (
                <div key={r.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{rDeleted ? tDeleted("label") : r.display_name ?? "—"}</span>
                      {r.username && (
                        <Link href={`/p/${r.username}`} style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
                          @{r.username}
                        </Link>
                      )}
                      {/* Awaiting review → jump straight to the review queue. */}
                      {r.moderation_status === "pending" && (
                        <Link href="/admin/review" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
                          {t("reviewLink")} →
                        </Link>
                      )}
                      {/* Changes requested → preview the reason (truncated; full text on hover). */}
                      {r.moderation_status === "changes_requested" && reasonById.get(r.id) && (
                        <span
                          title={reasonById.get(r.id)}
                          style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          <strong>{t("modReasonLabel")}</strong> {reasonById.get(r.id)}
                        </span>
                      )}
                    </div>
                    <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: r.is_bookable ? "var(--color-success)" : "var(--text-tertiary)" }}>
                      {r.is_bookable ? t("practBookable") : t("practNotBookable")}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1) var(--space-6)" }}>
                    <span style={statStyle}><span style={statLabel}>{t("practUpcoming")}</span> {numberFmt.format(r.upcoming_count)}</span>
                    <span style={statStyle}><span style={statLabel}>{t("practTotal")}</span> {numberFmt.format(r.total_sessions)}</span>
                    <span style={statStyle}><span style={statLabel}>{t("practRating")}</span> {rating}</span>
                    <span style={{ ...statStyle, color: connect.warn ? "var(--color-warning)" : "var(--text-secondary)" }}>
                      <span style={statLabel}>{t("practConnect")}</span> {connect.text}
                    </span>
                  </div>

                  <div>
                    <Link href={`/admin/practitioners/${r.id}/stats`} style={{ font: "var(--text-body-sm)", fontWeight: 600, color: "var(--accent)" }}>
                      {t("practViewStats")} →
                    </Link>
                  </div>

                  <PractitionerControls
                    practitionerId={r.id}
                    name={rDeleted ? tDeleted("label") : r.display_name ?? r.username ?? "—"}
                    moderationStatus={r.moderation_status}
                    payoutsFrozen={r.payouts_frozen}
                    commissionOverride={r.commission_rate_override == null ? null : Number(r.commission_rate_override)}
                    commissionReason={r.commission_rate_reason}
                    commissionSetOn={r.commission_rate_set_at ? dateFmt.format(new Date(r.commission_rate_set_at)) : null}
                    brandDefaultRate={COMMISSION_RATE}
                    subscriptionStatus={r.subscription_status}
                    subscriptionExempt={r.subscription_exempt}
                    subscriptionOverrideCents={r.subscription_price_override_cents}
                    subscriptionReason={r.subscription_override_reason}
                    subscriptionSetOn={r.subscription_override_set_at ? dateFmt.format(new Date(r.subscription_override_set_at)) : null}
                    defaultFeeCents={SUBSCRIPTION_PRICE_CENTS}
                  />
                </div>
              );
            })}
          </div>
        )}
      </ContentContainer>
    </main>
  );
}

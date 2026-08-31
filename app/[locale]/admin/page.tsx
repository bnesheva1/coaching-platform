import { Fragment } from "react";
import { Link } from "@/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled, KILL_SWITCHES, ADMIN_TOGGLEABLE, type FlagKey } from "@/lib/flags";
import { projectVideoUsage } from "@/lib/video";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { FlagToggle } from "@/components/admin/FlagToggle";
import { AdminSection } from "@/components/admin/AdminSection";
import { dismissAlert, setFlag } from "./actions";

export const dynamic = "force-dynamic";

const ALERTS_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 20;
function dayBounds(from?: string, to?: string) {
  return { fromIso: from ? `${from}T00:00:00.000Z` : null, toIso: to ? `${to}T23:59:59.999Z` : null };
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--color-danger)",
  warning: "var(--color-warning)",
  info: "var(--text-tertiary)",
};

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// The admin dashboard shell. Deliberately plain — an internal operator tool,
// not a product surface: token-styled, no charts, no chrome. Alerts, Controls
// (kill switches), Numbers (readouts), and the audit log.
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  // Defense in depth: the layout already gated, but this page reads privileged
  // (service-role) data, so it re-asserts before doing so.
  await requireAdmin();
  const sp = await searchParams;
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const intlLocale = INTL_LOCALES[locale] ?? "en-US";
  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" });
  const numberFmt = new Intl.NumberFormat(intlLocale);
  const eurFmt = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const eurFmt2 = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

  const supabase = createServiceRoleClient();
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nowIso = now.toISOString();

  // Alerts + audit are collapsible, date-filterable, and paginated — driven by
  // per-section query params (alertsFrom/To/Page, auditFrom/To/Page). Build each
  // query with its filters + range + an exact count for the pager, then fold
  // them into the one fan-out below.
  const alertsPage = Math.max(1, parseInt(sp.alertsPage ?? "", 10) || 1);
  const auditPage = Math.max(1, parseInt(sp.auditPage ?? "", 10) || 1);
  const aBounds = dayBounds(sp.alertsFrom, sp.alertsTo);
  const uBounds = dayBounds(sp.auditFrom, sp.auditTo);

  let alertsFilter = supabase.from("alerts").select("id, type, severity, message, context, first_seen_at", { count: "exact" }).eq("status", "active");
  if (aBounds.fromIso) alertsFilter = alertsFilter.gte("first_seen_at", aBounds.fromIso);
  if (aBounds.toIso) alertsFilter = alertsFilter.lte("first_seen_at", aBounds.toIso);
  const alertsQuery = alertsFilter
    .order("first_seen_at", { ascending: false })
    .range((alertsPage - 1) * ALERTS_PAGE_SIZE, alertsPage * ALERTS_PAGE_SIZE - 1);

  let auditFilter = supabase.from("admin_audit_log").select("id, actor_email, action, previous_value, new_value, created_at", { count: "exact" });
  if (uBounds.fromIso) auditFilter = auditFilter.gte("created_at", uBounds.fromIso);
  if (uBounds.toIso) auditFilter = auditFilter.lte("created_at", uBounds.toIso);
  const auditQuery = auditFilter
    .order("created_at", { ascending: false })
    .range((auditPage - 1) * AUDIT_PAGE_SIZE, auditPage * AUDIT_PAGE_SIZE - 1);

  // Everything the page needs, in one fan-out. Alerts + audit (filtered/paged
  // above), the resolved state of every toggleable switch, the Numbers readouts,
  // and the video cost projection.
  const [
    { data: alerts, count: alertsTotal },
    { data: auditEntries, count: auditTotal },
    switchPairs,
    bookingsUpcoming,
    bookingsThisWeek,
    bookingsTotal,
    practitionersRegistered,
    clientsRegistered,
    { data: activeServiceRows },
    { data: paymentRows },
    videoUsage,
  ] = await Promise.all([
    alertsQuery,
    auditQuery,
    Promise.all(ADMIN_TOGGLEABLE.map(async (k) => [k, await isEnabled(k)] as const)),
    supabase.from("bookings").select("id", { count: "exact", head: true }).in("status", ["pending", "confirmed"]).gte("start_utc", nowIso),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "confirmed"])
      .gte("start_utc", nowIso)
      .lt("start_utc", weekEnd),
    supabase.from("bookings").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "practitioner"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "client"),
    supabase.from("services").select("practitioner_id").eq("is_active", true),
    supabase.from("payments").select("amount_cents, commission_cents").eq("status", "succeeded").gte("created_at", monthStart),
    projectVideoUsage(now),
  ]);

  const switchState = Object.fromEntries(switchPairs) as Record<FlagKey, boolean>;
  const alertsPageCount = Math.max(1, Math.ceil((alertsTotal ?? 0) / ALERTS_PAGE_SIZE));
  const auditPageCount = Math.max(1, Math.ceil((auditTotal ?? 0) / AUDIT_PAGE_SIZE));

  // Bookable = has at least one active service (the activation gate a client
  // could actually book against). A registered practitioner who never got here
  // is a failed activation — the gap between these two numbers is the signal.
  const bookablePractitioners = new Set((activeServiceRows ?? []).map((r) => r.practitioner_id as string)).size;

  const grossCents = (paymentRows ?? []).reduce((s, p) => s + ((p.amount_cents as number) ?? 0), 0);
  const commissionCents = (paymentRows ?? []).reduce((s, p) => s + ((p.commission_cents as number) ?? 0), 0);

  // Which cost threshold the projection currently sits in — colours the video
  // readout and names the state.
  const cost = videoUsage.projectedCostEur;
  const { earlyAlertEur, highAlertEur, breakerEur } = videoUsage.thresholds;
  const costLevel =
    cost >= breakerEur ? "breaker" : cost >= highAlertEur ? "high" : cost >= earlyAlertEur ? "early" : "ok";
  const COST_LEVEL_COLOR: Record<string, string> = {
    ok: "var(--text-secondary)",
    early: "var(--color-warning)",
    high: "var(--color-warning)",
    breaker: "var(--color-danger)",
  };
  const minutesPct = Math.round(videoUsage.minutesUtilization * 100);
  const dataPct = Math.round(videoUsage.dataUtilization * 100);
  // Colour a usage row by how close it is to its ceiling — amber past 80%, red
  // once over — so an approaching limit reads before it turns into overage cost.
  const utilColor = (u: number) => (u >= 1 ? "var(--color-danger)" : u >= 0.8 ? "var(--color-warning)" : "var(--text-secondary)");

  const emptyStyle = { margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" } as const;
  const cellStyle = {
    padding: "var(--space-2) var(--space-3)",
    borderBottom: "1px solid var(--border-subtle)",
    textAlign: "left" as const,
    font: "var(--text-body-sm)",
    verticalAlign: "top" as const,
  };
  const cardStyle = {
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-1)",
  };
  const statValueStyle = { font: "var(--text-heading-md)", fontVariantNumeric: "tabular-nums" } as const;
  const statLabelStyle = {
    font: "var(--text-label)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  };

  const greenDotStyle = { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--color-success)", marginLeft: 6 } as const;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", margin: "0 0 var(--space-6)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("heading")}</h1>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Link href="/admin/practitioners" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
              {t("practLink")} →
            </Link>
            <Link href="/admin/health" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
              {t("healthLink")} →
            </Link>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {/* ── Alerts (collapsible · date-filtered · paginated) ───────── */}
          <AdminSection prefix="alerts" title={t("alertsHeading")} count={alertsTotal ?? 0} page={alertsPage} pageCount={alertsPageCount}>
            {(alerts ?? []).length === 0 ? (
              <p style={emptyStyle}>{t("alertsEmpty")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {(alerts ?? []).map((a) => {
                  const ctx = (a.context as Record<string, unknown>) ?? {};
                  return (
                    <div
                      key={a.id}
                      style={{
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-lg)",
                        padding: "var(--space-4)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-2)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                        <span
                          style={{
                            font: "var(--text-label)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: SEVERITY_COLOR[a.severity] ?? "var(--text-tertiary)",
                          }}
                        >
                          {a.severity} · {a.type}
                        </span>
                        <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                          {formatter.format(new Date(a.first_seen_at))}
                        </span>
                      </div>
                      <p style={{ margin: 0, font: "var(--text-body-md)" }}>{a.message}</p>
                      {Object.keys(ctx).length > 0 && (
                        <dl
                          style={{
                            margin: 0,
                            display: "grid",
                            gridTemplateColumns: "auto 1fr",
                            gap: "2px var(--space-3)",
                            font: "var(--text-body-sm)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {Object.entries(ctx).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt style={{ color: "var(--text-tertiary)" }}>{k}</dt>
                              <dd style={{ margin: 0, wordBreak: "break-word" }}>{String(v)}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      )}
                      <form action={dismissAlert.bind(null, a.id)} style={{ margin: 0, alignSelf: "flex-start" }}>
                        <Button type="submit" variant="ghost" size="sm">
                          {t("dismiss")}
                        </Button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </AdminSection>

          {/* ── Controls (kill switches) ──────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("controlsHeading")}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {KILL_SWITCHES.map((key) => {
                const on = switchState[key];
                const target = !on;
                const name = t(`switch_${key}` as Parameters<typeof t>[0]);
                return (
                  <div
                    key={key}
                    style={{
                      ...cardStyle,
                      gap: "var(--space-2)",
                      // off = the alarm state: a quiet red left edge, matching the pill
                      borderLeft: on ? undefined : "3px solid var(--color-danger)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{name}</span>
                        <span
                          style={{
                            font: "var(--text-label)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: on ? "var(--text-secondary)" : "var(--color-danger)",
                            whiteSpace: "nowrap",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          {on ? t("stateOn") : t("stateOff")}
                          {on && <span aria-hidden="true" style={greenDotStyle} />}
                        </span>
                      </span>
                      <FlagToggle
                        on={on}
                        ariaLabel={name}
                        action={setFlag.bind(null, key, target)}
                        tone={target ? "accent" : "danger"}
                        dialogTitle={t(target ? "confirmTitleOn" : "confirmTitleOff", { name })}
                        dialogBody={t((target ? `switchOn_${key}` : `switchOff_${key}`) as Parameters<typeof t>[0])}
                        confirmLabel={target ? t("turnOn") : t("turnOff")}
                        confirmPendingLabel={target ? t("turningOn") : t("turningOff")}
                        cancelLabel={t("confirmCancel")}
                        immediateLabel={t("confirmImmediate")}
                        loggedLabel={t("confirmLogged")}
                      />
                    </div>
                    {!on && (
                      <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                        {t(`switchOff_${key}` as Parameters<typeof t>[0])}
                      </p>
                    )}

                    {/* Cost override sits with the video switch — it governs the
                        automatic breaker, not video directly. Its risky direction is
                        ON (it suppresses the safety), so that's the amber one. */}
                    {key === "video" &&
                      (() => {
                        const ov = switchState.videoCostOverride;
                        const ovTarget = !ov;
                        const amount = eurFmt.format(breakerEur);
                        return (
                          <div style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                                <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("costOverrideLabel")}</span>
                                <span
                                  style={{
                                    font: "var(--text-label)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: ov ? "var(--color-warning)" : "var(--text-tertiary)",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {ov ? t("stateOn") : t("stateOff")}
                                </span>
                              </span>
                              <FlagToggle
                                on={ov}
                                small
                                override
                                ariaLabel={t("costOverrideLabel")}
                                action={setFlag.bind(null, "videoCostOverride", ovTarget)}
                                tone={ovTarget ? "warning" : "accent"}
                                dialogTitle={t(ovTarget ? "confirmTitleOn" : "confirmTitleOff", { name: t("costOverrideLabel") })}
                                dialogBody={t(ovTarget ? "costOverrideOnBody" : "costOverrideOffBody", { amount })}
                                confirmLabel={ovTarget ? t("turnOn") : t("turnOff")}
                                confirmPendingLabel={ovTarget ? t("turningOn") : t("turningOff")}
                                cancelLabel={t("confirmCancel")}
                                immediateLabel={t("confirmImmediate")}
                                loggedLabel={t("confirmLogged")}
                              />
                            </div>
                            <p style={{ margin: "var(--space-1) 0 0", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                              {t("costOverrideHelp", { amount })}
                            </p>
                          </div>
                        );
                      })()}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Numbers ───────────────────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("numbersHeading")}</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "var(--space-3)",
              }}
            >
              <div style={cardStyle}>
                <span style={statLabelStyle}>{t("numBookings")}</span>
                <span style={statValueStyle}>{numberFmt.format(bookingsUpcoming.count ?? 0)}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("numBookingsUpcoming")}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {t("numBookingsBreakdown", {
                    week: numberFmt.format(bookingsThisWeek.count ?? 0),
                    total: numberFmt.format(bookingsTotal.count ?? 0),
                  })}
                </span>
              </div>

              <div style={cardStyle}>
                <span style={statLabelStyle}>{t("numPractitioners")}</span>
                <span style={statValueStyle}>{numberFmt.format(bookablePractitioners)}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("numBookable")}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {t("numRegisteredOf", { total: numberFmt.format(practitionersRegistered.count ?? 0) })}
                </span>
              </div>

              <div style={cardStyle}>
                <span style={statLabelStyle}>{t("numClients")}</span>
                <span style={statValueStyle}>{numberFmt.format(clientsRegistered.count ?? 0)}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("numRegistered")}</span>
              </div>

              <div style={cardStyle}>
                <span style={statLabelStyle}>{t("numRevenue")}</span>
                <span style={statValueStyle}>{eurFmt2.format(grossCents / 100)}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{t("numRevenueGross")}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {t("numRevenueCommission", { amount: eurFmt2.format(commissionCents / 100) })}
                </span>
              </div>

              <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                  <span style={statLabelStyle}>{t("numVideo")}</span>
                  <span
                    style={{
                      font: "var(--text-label)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: COST_LEVEL_COLOR[costLevel],
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t(`costLevel_${costLevel}` as Parameters<typeof t>[0])}
                  </span>
                </div>
                <span style={statValueStyle}>{eurFmt2.format(cost)}</span>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                  {t("numVideoProjectedCost", {
                    early: eurFmt.format(earlyAlertEur),
                    high: eurFmt.format(highAlertEur),
                    breaker: eurFmt.format(breakerEur),
                  })}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "var(--space-1) var(--space-6)",
                    font: "var(--text-body-sm)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {/* Data first — it's the constraint that binds. Each row is
                      coloured by its own utilisation, so an approaching ceiling
                      shows even before any overage cost accrues. */}
                  <span style={{ color: utilColor(videoUsage.dataUtilization) }}>
                    {t("numVideoDataLabel")}: {numberFmt.format(videoUsage.projectedGb)} / {numberFmt.format(videoUsage.dataAllowanceGb)} GB ({dataPct}%)
                    {videoUsage.binding === "data" && ` · ${t("numVideoBinding")}`}
                  </span>
                  <span style={{ color: utilColor(videoUsage.minutesUtilization) }}>
                    {t("numVideoMinutesLabel")}: {numberFmt.format(videoUsage.projectedMinutes)} / {numberFmt.format(videoUsage.minutesAllowance)} ({minutesPct}%)
                    {videoUsage.binding === "minutes" && ` · ${t("numVideoBinding")}`}
                  </span>
                </div>
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                  {t("numVideoCommitted", { committed: numberFmt.format(videoUsage.committedMinutes) })}
                </span>
              </div>
            </div>
          </section>

          {/* ── Audit log (collapsible · date-filtered · paginated) ────── */}
          <AdminSection prefix="audit" title={t("auditHeading")} count={auditTotal ?? 0} page={auditPage} pageCount={auditPageCount}>
            {(auditEntries ?? []).length === 0 ? (
              <p style={emptyStyle}>{t("auditEmpty")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={cellStyle}>{t("auditColWhen")}</th>
                      <th style={cellStyle}>{t("auditColWho")}</th>
                      <th style={cellStyle}>{t("auditColAction")}</th>
                      <th style={cellStyle}>{t("auditColPrevious")}</th>
                      <th style={cellStyle}>{t("auditColNew")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditEntries ?? []).map((e) => (
                      <tr key={e.id}>
                        <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{formatter.format(new Date(e.created_at))}</td>
                        <td style={cellStyle}>{e.actor_email ?? "—"}</td>
                        <td style={cellStyle}>{e.action}</td>
                        <td style={cellStyle}>{e.previous_value ?? "—"}</td>
                        <td style={cellStyle}>{e.new_value ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminSection>
        </div>
      </ContentContainer>
    </main>
  );
}

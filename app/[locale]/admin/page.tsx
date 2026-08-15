import { Fragment } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled, KILL_SWITCHES, ADMIN_TOGGLEABLE, type FlagKey } from "@/lib/flags";
import { projectVideoUsage } from "@/lib/video";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { dismissAlert, setFlag } from "./actions";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#c0392b",
  warning: "#a15c00",
  info: "var(--text-tertiary)",
};

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// The admin dashboard shell. Deliberately plain — an internal operator tool,
// not a product surface: token-styled, no charts, no chrome. Alerts, Controls
// (kill switches), Numbers (readouts), and the audit log.
export default async function AdminPage() {
  // Defense in depth: the layout already gated, but this page reads privileged
  // (service-role) data, so it re-asserts before doing so.
  await requireAdmin();
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

  // Everything the page needs, in one fan-out. Alerts + audit (as before), the
  // resolved state of every toggleable switch, the Numbers readouts, and the
  // video cost projection.
  const [
    { data: alerts },
    { data: auditEntries },
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
    supabase
      .from("alerts")
      .select("id, type, severity, message, context, first_seen_at")
      .eq("status", "active")
      .order("first_seen_at", { ascending: false }),
    supabase
      .from("admin_audit_log")
      .select("id, actor_email, action, previous_value, new_value, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    Promise.all(ADMIN_TOGGLEABLE.map(async (k) => [k, await isEnabled(k)] as const)),
    supabase.from("bookings").select("id", { count: "exact", head: true }).neq("status", "cancelled").gte("start_utc", nowIso),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelled")
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
    early: "#a15c00",
    high: "#a15c00",
    breaker: "#c0392b",
  };

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

  // Each kill switch: its label + the one-line consequence shown when OFF.
  const switchMeta = KILL_SWITCHES.map((key) => ({
    key,
    label: t(`switch_${key}` as Parameters<typeof t>[0]),
    whenOff: t(`switchOff_${key}` as Parameters<typeof t>[0]),
  }));

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("heading")}</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {/* ── Alerts ────────────────────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("alertsHeading")}</h2>
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
          </section>

          {/* ── Controls (kill switches) ──────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("controlsHeading")}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {switchMeta.map(({ key, label, whenOff }) => {
                const on = switchState[key];
                return (
                  <div key={key} style={{ ...cardStyle, gap: "var(--space-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                      <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{label}</span>
                      <span
                        style={{
                          font: "var(--text-label)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: on ? "var(--text-secondary)" : "#c0392b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {on ? t("stateOn") : t("stateOff")}
                      </span>
                    </div>
                    {!on && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{whenOff}</p>}
                    <form action={setFlag.bind(null, key, !on)} style={{ margin: 0, alignSelf: "flex-start" }}>
                      <Button type="submit" variant={on ? "ghost" : "primary"} size="sm">
                        {on ? t("turnOff") : t("turnOn")}
                      </Button>
                    </form>

                    {/* Cost override sits with the video switch — it governs the
                        automatic €300 breaker, not video directly. */}
                    {key === "video" && (
                      <div style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-subtle)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline" }}>
                          <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{t("costOverrideLabel")}</span>
                          <span
                            style={{
                              font: "var(--text-label)",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              color: switchState.videoCostOverride ? "#a15c00" : "var(--text-tertiary)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {switchState.videoCostOverride ? t("stateOn") : t("stateOff")}
                          </span>
                        </div>
                        <p style={{ margin: "var(--space-1) 0 var(--space-2)", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                          {t("costOverrideHelp", { amount: eurFmt.format(breakerEur) })}
                        </p>
                        <form action={setFlag.bind(null, "videoCostOverride", !switchState.videoCostOverride)} style={{ margin: 0 }}>
                          <Button type="submit" variant="ghost" size="sm">
                            {switchState.videoCostOverride ? t("costOverrideDisable") : t("costOverrideEnable")}
                          </Button>
                        </form>
                      </div>
                    )}
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
                <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                  {t("numVideoMinutes", {
                    projected: numberFmt.format(videoUsage.projectedMinutes),
                    allowance: numberFmt.format(videoUsage.allowanceMinutes),
                    committed: numberFmt.format(videoUsage.committedMinutes),
                  })}
                </span>
              </div>
            </div>
          </section>

          {/* ── Audit log ─────────────────────────────────────────────── */}
          <section>
            <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{t("auditHeading")}</h2>
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
          </section>
        </div>
      </ContentContainer>
    </main>
  );
}

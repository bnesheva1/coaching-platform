import { Fragment } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { dismissAlert } from "./actions";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#c0392b",
  warning: "#a15c00",
  info: "var(--text-tertiary)",
};

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// The admin dashboard shell. Deliberately plain — an internal operator tool,
// not a product surface: token-styled, no charts, no chrome. Later slices fill
// the sections; today they're framed with empty states saying what will
// appear.
export default async function AdminPage() {
  // Defense in depth: the layout already gated, but this page reads privileged
  // (service-role) data, so it re-asserts before doing so.
  await requireAdmin();
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const formatter = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { dateStyle: "medium", timeStyle: "short" });

  const supabase = createServiceRoleClient();
  // Active alerts, newest first, with enough context to act on. And recent
  // audit entries. Both service-role — the tables are admin-only.
  const [{ data: alerts }, { data: auditEntries }] = await Promise.all([
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
  ]);

  const placeholderSections = [
    { heading: t("controlsHeading"), empty: t("controlsEmpty") },
    { heading: t("numbersHeading"), empty: t("numbersEmpty") },
  ];

  const emptyStyle = { margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" } as const;
  const cellStyle = {
    padding: "var(--space-2) var(--space-3)",
    borderBottom: "1px solid var(--border-subtle)",
    textAlign: "left" as const,
    font: "var(--text-body-sm)",
    verticalAlign: "top" as const,
  };

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <h1 style={{ font: "var(--text-heading-lg)", margin: "0 0 var(--space-6)" }}>{t("heading")}</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
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

          {placeholderSections.map((s) => (
            <section key={s.heading}>
              <h2 style={{ font: "var(--text-heading-sm)", margin: "0 0 var(--space-3)" }}>{s.heading}</h2>
              <p style={emptyStyle}>{s.empty}</p>
            </section>
          ))}

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

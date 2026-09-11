import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { ReviewControls } from "@/components/admin/ReviewControls";
import specialtiesData from "@/data/specialties.json";

export const dynamic = "force-dynamic";

type Loc = "bg" | "en";

// Admin review queue — profiles that a practitioner has explicitly SUBMITTED
// (moderation_status = 'pending' AND review_submitted_at set). Draft profiles
// (pending, never submitted) deliberately don't appear here. Lives inside the
// existing admin area, linked from /admin.
export default async function AdminReviewPage() {
  await requireAdmin();
  const t = await getTranslations("Admin");
  const locale = (await getLocale()) as Loc;
  const supabase = createServiceRoleClient();

  const { data: profiles } = await supabase
    .from("practitioner_profiles")
    .select("id, username, bio, headline, location, avatar_url, specialties, review_submitted_at")
    .eq("moderation_status", "pending")
    .not("review_submitted_at", "is", null)
    .order("review_submitted_at", { ascending: true });

  const rows = profiles ?? [];
  const ids = rows.map((r) => r.id as string);

  // Names/emails (profiles) + services, in two batched lookups.
  type PersonRow = { id: string; display_name: string | null; email: string | null };
  type ServiceRow = { practitioner_id: string; name: string; duration_minutes: number; price_cents: number; currency: string; is_active: boolean };
  const [{ data: people }, { data: services }] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select("id, display_name, email").in("id", ids)
      : Promise.resolve({ data: [] as PersonRow[] }),
    ids.length
      ? supabase.from("services").select("practitioner_id, name, duration_minutes, price_cents, currency, is_active").in("practitioner_id", ids)
      : Promise.resolve({ data: [] as ServiceRow[] }),
  ]);
  const personById = new Map(((people ?? []) as PersonRow[]).map((p) => [p.id, p]));
  const servicesByPractitioner = new Map<string, ServiceRow[]>();
  for (const s of (services ?? []) as ServiceRow[]) {
    const list = servicesByPractitioner.get(s.practitioner_id) ?? [];
    list.push(s);
    servicesByPractitioner.set(s.practitioner_id, list);
  }
  const specialtyLabel = (key: string) =>
    (specialtiesData as { key: string; en: string; bg: string }[]).find((s) => s.key === key)?.[locale] ?? key;
  const dateFmt = new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("reviewHeading")}</h1>
          <Link href="/admin" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("healthBackToAdmin")}
          </Link>
        </div>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>{t("reviewSubtitle")}</p>

        {rows.length === 0 ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("reviewEmpty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {rows.map((r) => {
              const person = personById.get(r.id as string);
              const name = (person?.display_name as string | null) ?? (r.username as string | null) ?? "—";
              const svc = servicesByPractitioner.get(r.id as string) ?? [];
              const specialties = (r.specialties as string[] | null) ?? [];
              return (
                <div
                  key={r.id as string}
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--bg-surface)",
                    padding: "var(--space-5)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-3)",
                  }}
                >
                  {/* Identity + submitted-at */}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "baseline" }}>
                    <div>
                      <span style={{ font: "var(--text-heading-sm)", fontWeight: 700 }}>{name}</span>
                      {r.username && <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}> · @{r.username as string}</span>}
                      {person?.email && <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}> · {person.email}</span>}
                    </div>
                    {r.review_submitted_at && (
                      <span style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                        {t("reviewSubmittedLabel")} {dateFmt.format(new Date(r.review_submitted_at as string))}
                      </span>
                    )}
                  </div>

                  {/* Preview: headline, location, specialties, bio, services */}
                  {r.headline && <p style={{ margin: 0, font: "var(--text-body-md)", fontWeight: 600 }}>{r.headline as string}</p>}
                  {r.location && <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{r.location as string}</p>}
                  {specialties.length > 0 && (
                    <p style={{ margin: 0, font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                      <strong>{t("reviewSpecialties")}</strong> {specialties.map(specialtyLabel).join(", ")}
                    </p>
                  )}
                  {r.bio && <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{r.bio as string}</p>}
                  {svc.length > 0 && (
                    <div style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                      <strong>{t("reviewServices")}</strong>
                      <ul style={{ margin: "var(--space-1) 0 0", paddingLeft: "var(--space-5)" }}>
                        {svc.map((s, i) => (
                          <li key={i}>
                            {s.name} — {s.duration_minutes} мин · {(s.price_cents / 100).toFixed(0)} {s.currency}
                            {!s.is_active ? ` · ${t("reviewServiceInactive")}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {r.username && (
                    <Link href={`/p/${r.username as string}`} style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
                      {t("reviewViewProfile")} →
                    </Link>
                  )}

                  <ReviewControls
                    practitionerId={r.id as string}
                    labels={{
                      approve: t("reviewApprove"),
                      reject: t("reviewReject"),
                      reasonPlaceholder: t("reviewReasonPlaceholder"),
                      reasonRequired: t("reviewReasonRequired"),
                      genericError: t("reviewError"),
                    }}
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

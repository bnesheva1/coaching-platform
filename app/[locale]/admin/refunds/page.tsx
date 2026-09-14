import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { RefundReviewControls } from "@/components/admin/RefundReviewControls";

export const dynamic = "force-dynamic";

type Loc = "bg" | "en";
const REASON_FILTERS = ["technical_failure", "other"] as const;

// Admin refund-request queue — pending client requests. technical_failure is
// badged + filterable and shows a corroborating session-data line (duration +
// attendance) for fast triage; "other" is free-text. Approve triggers the real
// refund; deny records a client-visible reason. Same shape as /admin/review.
export default async function AdminRefundsPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  await requireAdmin();
  const t = await getTranslations("Admin");
  const locale = (await getLocale()) as Loc;
  const supabase = createServiceRoleClient();
  const params = await searchParams;
  const reason = (REASON_FILTERS as readonly string[]).includes(params.reason ?? "") ? params.reason! : "";

  const { data: allPending } = await supabase
    .from("refund_requests")
    .select("id, booking_id, reason_type, reason_text, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const all = allPending ?? [];
  const countByReason = new Map<string, number>();
  for (const r of all) countByReason.set(r.reason_type, (countByReason.get(r.reason_type) ?? 0) + 1);
  const rows = reason ? all.filter((r) => r.reason_type === reason) : all;

  const bookingIds = rows.map((r) => r.booking_id as string);
  const { data: bookings } = bookingIds.length
    ? await supabase.from("bookings").select("id, start_utc, end_utc, practitioner_id, client_id, service_name, price_cents, currency").in("id", bookingIds)
    : { data: [] as { id: string; start_utc: string; end_utc: string; practitioner_id: string; client_id: string; service_name: string; price_cents: number; currency: string }[] };
  const bookingById = new Map((bookings ?? []).map((b) => [b.id as string, b]));
  const peopleIds = [...new Set((bookings ?? []).flatMap((b) => [b.practitioner_id as string, b.client_id as string]))];
  const { data: people } = peopleIds.length ? await supabase.from("profiles").select("id, display_name").in("id", peopleIds) : { data: [] as { id: string; display_name: string | null }[] };
  const nameById = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string | null]));

  // Attendance corroboration for the technical rows (best-effort — skipped if the
  // table isn't there). Count distinct participants who have an attendance row.
  const joinedByBooking = new Map<string, number>();
  const techIds = rows.filter((r) => r.reason_type === "technical_failure").map((r) => r.booking_id as string);
  if (techIds.length) {
    const { data: att } = await supabase.from("video_attendance_events").select("booking_id, participant_id").in("booking_id", techIds);
    const seen = new Map<string, Set<string>>();
    for (const a of att ?? []) {
      if (!a.participant_id) continue;
      const s = seen.get(a.booking_id as string) ?? new Set<string>();
      s.add(a.participant_id as string);
      seen.set(a.booking_id as string, s);
    }
    for (const [bid, s] of seen) joinedByBooking.set(bid, s.size);
  }

  const dateFmt = new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const controlLabels = {
    approve: t("refundApprove"),
    deny: t("refundDeny"),
    reasonPlaceholder: t("refundDenyPlaceholder"),
    reasonRequired: t("refundDenyReasonRequired"),
    noPayment: t("refundNoPayment"),
    refundFailed: t("refundFailed"),
    notPending: t("refundNotPending"),
  };
  const tabHref = (r: string) => `/admin/refunds${r ? `?reason=${r}` : ""}`;

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("refundsHeading")}</h1>
          <Link href="/admin" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>← {t("healthBackToAdmin")}</Link>
        </div>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-4)" }}>{t("refundsSubtitle")}</p>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
          {["", ...REASON_FILTERS].map((r) => {
            const active = r === reason;
            const label = r === "" ? t("filterAll") : t(`refundReason_${r}` as Parameters<typeof t>[0]);
            const count = r === "" ? all.length : countByReason.get(r) ?? 0;
            return (
              <Link key={r || "all"} href={tabHref(r)} style={{ font: "var(--text-body-sm)", textDecoration: "none", padding: "var(--space-1) var(--space-3)", borderRadius: "var(--radius-pill)", border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`, background: active ? "var(--accent-subtle)" : "transparent", color: active ? "var(--accent-subtle-text)" : "var(--text-secondary)", fontWeight: active ? 600 : 400 }}>
                {label} ({count})
              </Link>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("refundsEmpty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {rows.map((r) => {
              const b = bookingById.get(r.booking_id as string);
              const clientName = (b && nameById.get(b.client_id as string)) || "—";
              const pracName = (b && nameById.get(b.practitioner_id as string)) || "—";
              const isTech = r.reason_type === "technical_failure";
              const durationMin = b ? Math.round((new Date(b.end_utc as string).getTime() - new Date(b.start_utc as string).getTime()) / 60000) : null;
              const joined = joinedByBooking.get(r.booking_id as string);
              return (
                <div key={r.id} style={{ border: "1px solid var(--border-subtle)", borderLeft: `4px solid ${isTech ? "var(--color-warning)" : "var(--border-subtle)"}`, borderRadius: "var(--radius-lg)", background: "var(--bg-surface)", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ font: "var(--text-heading-sm)", fontWeight: 700 }}>{clientName} → {pracName}</span>
                    <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
                      {isTech && <span style={{ font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-warning)", border: "1px solid var(--color-warning)", borderRadius: "var(--radius-pill)", padding: "1px 8px" }}>{t("refundReason_technical_failure")}</span>}
                      {b && <span style={{ font: "var(--text-body-sm)", fontWeight: 600 }}>{(b.price_cents / 100).toFixed(2)} {b.currency}</span>}
                    </span>
                  </div>
                  {b && <div style={{ font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>{b.service_name} · {dateFmt.format(new Date(b.start_utc as string))}</div>}
                  {r.reason_text && <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{r.reason_text as string}</p>}
                  {isTech && (
                    <div style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)" }}>
                      <strong>{t("refundSessionData")}</strong> {t("refundDurationMin", { minutes: durationMin ?? 0 })}
                      {joined !== undefined ? ` · ${t("refundJoinedCount", { count: joined })}` : ` · ${t("refundNoAttendance")}`}
                    </div>
                  )}
                  <RefundReviewControls requestId={r.id as string} labels={controlLabels} />
                </div>
              );
            })}
          </div>
        )}
      </ContentContainer>
    </main>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { PayoutControls } from "@/components/admin/PayoutControls";
import { PAYOUT_HOLD_HOURS } from "@/lib/payments/stripe/transfer";

export const dynamic = "force-dynamic";

// Held/pending practitioner payouts — the money the platform is holding until
// each booking's release time. Admins can release early or extend the hold per
// booking (on top of the practitioner-level freeze switch).
export default async function AdminPayoutsPage() {
  await requireAdmin();
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const supabase = createServiceRoleClient();

  const { data: payments } = await supabase
    .from("payments")
    .select("id, booking_id, amount_cents, commission_cents, currency, transfer_status, release_at")
    .eq("status", "succeeded")
    .in("transfer_status", ["pending", "held"])
    .order("release_at", { ascending: true, nullsFirst: true });
  const rows = payments ?? [];
  const bookingIds = rows.map((r) => r.booking_id).filter(Boolean) as string[];

  const { data: bookings } = bookingIds.length
    ? await supabase.from("bookings").select("id, start_utc, end_utc, practitioner_id").in("id", bookingIds)
    : { data: [] as { id: string; start_utc: string; end_utc: string; practitioner_id: string }[] };
  const bookingById = new Map((bookings ?? []).map((b) => [b.id as string, b]));
  const pracIds = [...new Set((bookings ?? []).map((b) => b.practitioner_id as string))];
  const [{ data: people }, { data: pracs }] = await Promise.all([
    pracIds.length ? supabase.from("profiles").select("id, display_name").in("id", pracIds) : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    pracIds.length ? supabase.from("practitioner_profiles").select("id, payouts_frozen").in("id", pracIds) : Promise.resolve({ data: [] as { id: string; payouts_frozen: boolean }[] }),
  ]);
  const nameById = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  const frozenById = new Map((pracs ?? []).map((p) => [p.id as string, p.payouts_frozen as boolean]));

  const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;
  const dateFmt = new Intl.DateTimeFormat(locale === "bg" ? "bg-BG" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const controlLabels = {
    releaseNow: t("payoutReleaseNow"),
    extendHold: t("payoutExtendHold"),
    days: t("payoutExtendDays"),
    frozen: t("payoutErrFrozen"),
    transferFailed: t("payoutErrTransferFailed"),
    notReleasable: t("payoutErrNotReleasable"),
    invalidDays: t("payoutErrInvalidDays"),
  };

  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("payoutsHeading")}</h1>
          <Link href="/admin" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
            ← {t("healthBackToAdmin")}
          </Link>
        </div>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("payoutsSubtitle", { hours: PAYOUT_HOLD_HOURS })}
        </p>

        {rows.length === 0 ? (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-tertiary)" }}>{t("payoutsEmpty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {rows.map((r) => {
              const booking = r.booking_id ? bookingById.get(r.booking_id) : null;
              const name = (booking && nameById.get(booking.practitioner_id as string)) || "—";
              const frozen = booking ? frozenById.get(booking.practitioner_id as string) : false;
              const share = r.amount_cents - r.commission_cents;
              const releaseAt = r.release_at
                ? new Date(r.release_at as string)
                : booking
                  ? new Date(new Date(booking.end_utc as string).getTime() + PAYOUT_HOLD_HOURS * 3_600_000)
                  : null;
              return (
                <div key={r.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ font: "var(--text-heading-sm)", fontWeight: 700 }}>{name}</span>
                    <span style={{ font: "var(--text-body-md)", fontWeight: 600 }}>{money(share, r.currency as string)}</span>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", font: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
                    <span>{t(`payoutStatus_${r.transfer_status}` as Parameters<typeof t>[0])}</span>
                    {releaseAt && <span>{t("payoutReleaseAt")} {dateFmt.format(releaseAt)}</span>}
                    {booking && <span>{t("payoutSession")} {dateFmt.format(new Date(booking.start_utc as string))}</span>}
                    {frozen && <span style={{ color: "var(--color-danger)" }}>{t("payoutFrozen")}</span>}
                  </div>
                  {r.booking_id && <PayoutControls bookingId={r.booking_id} labels={controlLabels} />}
                </div>
              );
            })}
          </div>
        )}
      </ContentContainer>
    </main>
  );
}

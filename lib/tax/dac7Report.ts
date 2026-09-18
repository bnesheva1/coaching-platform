import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { TinType } from "./tin";

// DAC7 quarterly aggregation — read-only, service-role only, NEVER exposed
// publicly. "Can we correctly compute the numbers", not the NRA submission
// format (that's pending lawyer/accountant confirmation of Bulgaria's schema).
//
// Basis (OECD Model Rules): consideration is reported in the quarter it was
// CREDITED to the seller — the Stripe Transfer created by the payout release
// sweep — so we bucket by transferred_at and count ONLY released rows.
// Not-yet-released (pending/held) payouts aren't credited yet → not reportable.
// Refunded/reversed rows are excluded (status <> succeeded/completed, or the
// transfer was clawed back). Both bookings (completed sessions) and digital
// content sales are included — both are platform-facilitated consideration.
//
// Consideration is reported GROSS (the client's full charge) with commission as
// a separate figure (DAC7 has both as distinct elements); net is derived for
// cross-checking. Which maps to which NRA element is the accountant's call.

export type Dac7QuarterRow = {
  practitionerId: string;
  displayName: string | null;
  tin: string | null;
  tinType: TinType | null;
  tinMissing: boolean;
  quarter: 1 | 2 | 3 | 4;
  considerationCents: number; // gross (client's full charge)
  commissionCents: number; // platform commission withheld
  netCents: number; // considerationCents - commissionCents (credited to seller)
  activities: number; // completed paid sessions + content sales credited this quarter
  currency: string;
};

export type Dac7Report = {
  year: number;
  generatedAt: string;
  basis: string;
  rows: Dac7QuarterRow[];
  practitionersMissingTin: { practitionerId: string; displayName: string | null }[];
};

const quarterOf = (ts: string): 1 | 2 | 3 | 4 => (Math.floor(new Date(ts).getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;

export async function buildDac7QuarterlyReport(year: number): Promise<Dac7Report> {
  const svc = createServiceRoleClient();
  const start = `${year}-01-01T00:00:00.000Z`;
  const end = `${year + 1}-01-01T00:00:00.000Z`;

  // Bookings: released + succeeded payments credited within the year, joined to
  // bookings for the practitioner. (Service role bypasses RLS.)
  const { data: payRows } = await svc
    .from("payments")
    .select("amount_cents, commission_cents, currency, transferred_at, bookings!inner(practitioner_id)")
    .eq("status", "succeeded")
    .eq("transfer_status", "released")
    .gte("transferred_at", start)
    .lt("transferred_at", end);

  // Content sales: released + completed content purchases credited within the year.
  const { data: contentRows } = await svc
    .from("content_purchases")
    .select("amount_cents, commission_cents, currency, transferred_at, practitioner_id")
    .eq("status", "completed")
    .eq("transfer_status", "released")
    .gte("transferred_at", start)
    .lt("transferred_at", end);

  // Aggregate per (practitioner, quarter).
  const key = (pracId: string, q: number) => `${pracId}:${q}`;
  const acc = new Map<string, Dac7QuarterRow>();
  const bump = (pracId: string, ts: string, amount: number, commission: number, currency: string) => {
    const q = quarterOf(ts);
    const k = key(pracId, q);
    const row =
      acc.get(k) ??
      ({ practitionerId: pracId, displayName: null, tin: null, tinType: null, tinMissing: true, quarter: q, considerationCents: 0, commissionCents: 0, netCents: 0, activities: 0, currency } as Dac7QuarterRow);
    row.considerationCents += amount;
    row.commissionCents += commission;
    row.netCents += amount - commission;
    row.activities += 1;
    acc.set(k, row);
  };

  for (const p of payRows ?? []) {
    // PostgREST embeds a to-one relation as an object (or a 1-element array).
    const b = p.bookings as unknown as { practitioner_id: string } | { practitioner_id: string }[];
    const pracId = Array.isArray(b) ? b[0]?.practitioner_id : b?.practitioner_id;
    if (pracId && p.transferred_at) bump(pracId, p.transferred_at as string, p.amount_cents as number, p.commission_cents as number, (p.currency as string) ?? "EUR");
  }
  for (const c of contentRows ?? []) {
    if (c.practitioner_id && c.transferred_at) bump(c.practitioner_id as string, c.transferred_at as string, c.amount_cents as number, (c.commission_cents as number) ?? 0, (c.currency as string) ?? "EUR");
  }

  // Enrich with TIN (service-role read of the excluded columns) + display name.
  const pracIds = [...new Set([...acc.values()].map((r) => r.practitionerId))];
  if (pracIds.length > 0) {
    const [{ data: profs }, { data: names }] = await Promise.all([
      svc.from("practitioner_profiles").select("id, tin, tin_type").in("id", pracIds),
      svc.from("profiles").select("id, display_name").in("id", pracIds),
    ]);
    const tinById = new Map((profs ?? []).map((p) => [p.id as string, p]));
    const nameById = new Map((names ?? []).map((n) => [n.id as string, n.display_name as string | null]));
    for (const row of acc.values()) {
      const t = tinById.get(row.practitionerId);
      row.tin = (t?.tin as string | null) ?? null;
      row.tinType = (t?.tin_type as TinType | null) ?? null;
      row.tinMissing = !row.tin;
      row.displayName = nameById.get(row.practitionerId) ?? null;
    }
  }

  const rows = [...acc.values()].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "") || a.quarter - b.quarter);
  const practitionersMissingTin = [
    ...new Map(rows.filter((r) => r.tinMissing).map((r) => [r.practitionerId, { practitionerId: r.practitionerId, displayName: r.displayName }])).values(),
  ];

  return {
    year,
    generatedAt: new Date().toISOString(),
    basis: "Consideration bucketed by Stripe Transfer (payout release) date; released rows only; gross consideration with commission separate; refunds/reversals excluded; bookings + content sales.",
    rows,
    practitionersMissingTin,
  };
}

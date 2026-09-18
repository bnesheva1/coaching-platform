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

// A row's consideration comes from ONE source:
//   "transfer"     — money we actually processed + transferred to the seller
//                    (commission bookings + content sales), bucketed by the
//                    Stripe Transfer date, commission withheld.
//   "listed_price" — a software_provider booking where payment was taken
//                    off-platform (no payments row): DAC7 still applies (we
//                    facilitate the booking/contract, not just payment
//                    processing), so consideration is the booking's LISTED price,
//                    bucketed by the session/completion date, commission 0.
// Kept distinct because the filing may treat "known transferred amount" vs
// "listed/contracted amount" differently.
export type Dac7ConsiderationSource = "transfer" | "listed_price";

export type Dac7QuarterRow = {
  practitionerId: string;
  displayName: string | null;
  tin: string | null;
  tinType: TinType | null;
  tinMissing: boolean;
  quarter: 1 | 2 | 3 | 4;
  source: Dac7ConsiderationSource;
  considerationCents: number; // gross (client's full charge, or listed price)
  commissionCents: number; // platform commission withheld (0 for listed_price)
  netCents: number; // considerationCents - commissionCents
  activities: number; // completed sessions + content sales in this quarter
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
  const key = (pracId: string, q: number, source: Dac7ConsiderationSource) => `${pracId}:${q}:${source}`;
  const acc = new Map<string, Dac7QuarterRow>();
  const bump = (pracId: string, source: Dac7ConsiderationSource, ts: string, amount: number, commission: number, currency: string) => {
    const q = quarterOf(ts);
    const k = key(pracId, q, source);
    const row =
      acc.get(k) ??
      ({ practitionerId: pracId, displayName: null, tin: null, tinType: null, tinMissing: true, quarter: q, source, considerationCents: 0, commissionCents: 0, netCents: 0, activities: 0, currency } as Dac7QuarterRow);
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
    if (pracId && p.transferred_at) bump(pracId, "transfer", p.transferred_at as string, p.amount_cents as number, p.commission_cents as number, (p.currency as string) ?? "EUR");
  }
  for (const c of contentRows ?? []) {
    if (c.practitioner_id && c.transferred_at) bump(c.practitioner_id as string, "transfer", c.transferred_at as string, c.amount_cents as number, (c.commission_cents as number) ?? 0, (c.currency as string) ?? "EUR");
  }

  // Listed-price consideration: completed bookings with NO payments row — i.e.
  // software_provider practitioners, who take payment off-platform but whose
  // booking we still facilitate (in DAC7 scope). Consideration = the booking's
  // listed price; commission 0; bucketed by the session/completion date
  // (end_utc), since there's no transfer event to date it by. Bookings WITH a
  // payment are handled by the transfer path above, so they're skipped here (no
  // double count).
  const { data: completedBookings } = await svc
    .from("bookings")
    .select("id, practitioner_id, price_cents, currency, end_utc")
    .eq("status", "completed")
    .gte("end_utc", start)
    .lt("end_utc", end);
  const bkIds = (completedBookings ?? []).map((b) => b.id as string);
  const { data: paidRows } = bkIds.length ? await svc.from("payments").select("booking_id").in("booking_id", bkIds) : { data: [] as { booking_id: string }[] };
  const paidSet = new Set((paidRows ?? []).map((p) => p.booking_id as string));
  for (const b of completedBookings ?? []) {
    if (paidSet.has(b.id as string)) continue; // has a payment → counted via transfer path
    if (b.practitioner_id && b.end_utc) bump(b.practitioner_id as string, "listed_price", b.end_utc as string, (b.price_cents as number) ?? 0, 0, (b.currency as string) ?? "EUR");
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

  const rows = [...acc.values()].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "") || a.quarter - b.quarter || a.source.localeCompare(b.source));
  const practitionersMissingTin = [
    ...new Map(rows.filter((r) => r.tinMissing).map((r) => [r.practitionerId, { practitionerId: r.practitionerId, displayName: r.displayName }])).values(),
  ];

  return {
    year,
    generatedAt: new Date().toISOString(),
    basis: "Two sources, flagged per row. transfer: commission bookings + content sales we processed, bucketed by Stripe Transfer (payout release) date, released only, refunds/reversals excluded, gross consideration + commission separate. listed_price: software_provider completed bookings (payment off-platform, no payments row) at the booking's listed price, commission 0, bucketed by session/completion date. Not the NRA filing format.",
    rows,
    practitionersMissingTin,
  };
}

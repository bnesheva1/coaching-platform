import "server-only";
import { DateTime } from "luxon";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

const ZONE = "Europe/Sofia";
const NO_SHOW_OUTCOMES = new Set(["client_no_show", "neither_attended"]);

export type PractitionerStats = {
  bookings: { thisMonth: number; lastMonth: number; allTime: number };
  outcomes: {
    completed: number;
    cancelledByClient: number;
    cancelledByPractitioner: number;
    cancelledByAdmin: number;
    // No-show only exists for VIDEO sessions (video_sessions.outcome) — there's no
    // no-show concept for phone/in-person bookings, so this is a video-only figure.
    noShow: number;
  };
  repeatClients: number;
  revenue: { grossCents: number; netCents: number; refundCount: number; refundCents: number; currency: string };
  reviews: { count: number; average: number | null };
  // The funnel over the current month: viewed → opened schedule → booked →
  // completed. The opened→booked step is the one worth reading.
  funnel: { viewed: number; opened: number; booked: number; completed: number };
  // True once there's anything to show — drives the empty state for a brand-new
  // practitioner (so they see what WILL appear, not a wall of zeros).
  hasAnyData: boolean;
};

// A "real" booking — pending means the client never completed payment, so it isn't
// a booking that happened.
const isReal = (status: string) => status !== "pending";

export async function getPractitionerStats(practitionerId: string): Promise<PractitionerStats> {
  const svc = createServiceRoleClient();

  const nowZ = DateTime.now().setZone(ZONE);
  const thisMonthStart = nowZ.startOf("month");
  const lastMonthStart = thisMonthStart.minus({ months: 1 });
  const thisMonthStartUtc = thisMonthStart.toUTC().toISO() as string;
  const lastMonthStartUtc = lastMonthStart.toUTC().toISO() as string;
  const thisMonthDate = thisMonthStart.toISODate() as string; // matches counters.period_start

  const [{ data: bookingRows }, { data: reviewRows }, { data: counterRows }] = await Promise.all([
    svc.from("bookings").select("id, status, created_at, client_id").eq("practitioner_id", practitionerId),
    svc.from("reviews").select("rating").eq("practitioner_id", practitionerId),
    svc.from("practitioner_view_counters").select("metric, bucket, period_start, count").eq("practitioner_id", practitionerId).eq("bucket", "month").eq("period_start", thisMonthDate),
  ]);
  const bookings = (bookingRows ?? []) as { id: string; status: string; created_at: string; client_id: string }[];
  const bookingIds = bookings.map((b) => b.id);

  // Payments + no-show need the booking id set; skip the round trips when there are none.
  const [{ data: paymentRows }, { data: videoRows }] = await Promise.all([
    bookingIds.length ? svc.from("payments").select("amount_cents, commission_cents, currency, status").in("booking_id", bookingIds) : Promise.resolve({ data: [] }),
    bookingIds.length ? svc.from("video_sessions").select("outcome").in("booking_id", bookingIds) : Promise.resolve({ data: [] }),
  ]);
  const payments = (paymentRows ?? []) as { amount_cents: number; commission_cents: number; currency: string; status: string }[];
  const videos = (videoRows ?? []) as { outcome: string | null }[];

  // ── Bookings by period + outcomes + repeat clients ──
  const real = bookings.filter((b) => isReal(b.status));
  const inThisMonth = (b: { created_at: string }) => b.created_at >= thisMonthStartUtc;
  const inLastMonth = (b: { created_at: string }) => b.created_at >= lastMonthStartUtc && b.created_at < thisMonthStartUtc;

  const byClient = new Map<string, number>();
  for (const b of real) byClient.set(b.client_id, (byClient.get(b.client_id) ?? 0) + 1);
  const repeatClients = [...byClient.values()].filter((n) => n >= 2).length;

  const countStatus = (s: string) => bookings.filter((b) => b.status === s).length;
  const noShow = videos.filter((v) => v.outcome && NO_SHOW_OUTCOMES.has(v.outcome)).length;

  // ── Revenue ──
  const succeeded = payments.filter((p) => p.status === "succeeded");
  const refunded = payments.filter((p) => p.status === "refunded");
  const grossCents = succeeded.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  const netCents = succeeded.reduce((s, p) => s + ((p.amount_cents ?? 0) - (p.commission_cents ?? 0)), 0);
  const refundCents = refunded.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  const currency = payments[0]?.currency ?? "EUR";

  // ── Reviews ──
  const ratings = (reviewRows ?? []).map((r) => r.rating as number);
  const reviewCount = ratings.length;
  const average = reviewCount ? Math.round((ratings.reduce((s, r) => s + r, 0) / reviewCount) * 100) / 100 : null;

  // ── Funnel (this month) ──
  const viewed = counterRows?.find((c) => c.metric === "profile_viewed")?.count ?? 0;
  const opened = counterRows?.find((c) => c.metric === "schedule_opened")?.count ?? 0;
  const bookedThisMonth = real.filter(inThisMonth).length;
  const completedThisMonth = bookings.filter((b) => b.status === "completed" && inThisMonth(b)).length;

  const allTime = real.length;
  const hasAnyData = allTime > 0 || reviewCount > 0 || viewed > 0 || opened > 0;

  return {
    bookings: { thisMonth: bookedThisMonth, lastMonth: real.filter(inLastMonth).length, allTime },
    outcomes: {
      completed: countStatus("completed"),
      cancelledByClient: countStatus("cancelled_by_client"),
      cancelledByPractitioner: countStatus("cancelled_by_practitioner"),
      cancelledByAdmin: countStatus("cancelled_by_admin"),
      noShow,
    },
    repeatClients,
    revenue: { grossCents, netCents, refundCount: refunded.length, refundCents, currency },
    reviews: { count: reviewCount, average },
    funnel: { viewed, opened, booked: bookedThisMonth, completed: completedThisMonth },
    hasAnyData,
  };
}

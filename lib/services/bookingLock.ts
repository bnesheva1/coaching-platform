import type { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/booking-time";

// "Active or upcoming" — a real, current booking that hasn't finished
// yet: not cancelled, not completed, and its session hasn't already
// ended (end_utc, not start_utc — a session currently in progress still
// counts, only ones that have genuinely wrapped up don't). Used both to
// render the locked/disabled state (services/page.tsx, informational)
// and to independently re-verify it server-side before accepting an
// update to a locked field (services-actions.ts, the actual
// enforcement — never trust that the client's disabled attribute held).
export async function getUpcomingBookingCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  serviceId: string,
): Promise<number> {
  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId)
    .in("status", [...ACTIVE_STATUSES])
    .gt("end_utc", new Date().toISOString());
  return count ?? 0;
}

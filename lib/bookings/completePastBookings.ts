import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

export type CompletePastBookingsResult = {
  bookingsCompleted: number;
};

// The entire completion mechanism: any booking that was pending or
// confirmed and whose session has ended becomes completed, unlocking it
// for a review. Cancelled bookings are excluded by the same WHERE, so a
// cancellation before the session time permanently prevents completion.
// A single atomic UPDATE, not a per-row loop with external calls (unlike
// sendReminderBatch, which calls out to Resend per recipient) — so this
// needs no batch-size cap.
export async function completePastBookings(): Promise<CompletePastBookingsResult> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "completed" })
    .in("status", ["pending", "confirmed"])
    .lt("end_utc", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("completePastBookings failed", { error });
    return { bookingsCompleted: 0 };
  }

  return { bookingsCompleted: (data ?? []).length };
}

import { createClient } from "@/lib/supabase/server";

export type OwnBooking = {
  id: string;
  startUtc: string;
  endUtc: string;
};

// The server-only wrapper the slot picker calls to mark the viewing
// client's own existing bookings with this practitioner — never called
// for a null/practitioner viewerRole (see SlotPicker's caller), since
// only an authenticated client can structurally have "own bookings"
// here to begin with.
//
// No explicit `.eq("client_id", ...)` filter is needed: the bookings
// table's own RLS policy (`auth.uid() = client_id or auth.uid() =
// practitioner_id`, see 20260710160000_create_bookings.sql) already
// restricts every row this query can possibly see to the caller's own,
// before this function's own `.eq("practitioner_id", ...)` is even
// applied. A different client running the exact same query gets back
// nothing for this practitioner — the isolation is enforced by
// Postgres, not by this function's filters.
export async function getOwnBookingsWithPractitioner({
  practitionerId,
}: {
  practitionerId: string;
}): Promise<OwnBooking[]> {
  const supabase = await createClient();

  // Same "active" definition BookingsList.tsx uses (ACTIVE_STATUSES) —
  // a cancelled or already-completed booking has nothing left to mark
  // as "yours" on an upcoming-availability picker.
  const { data, error } = await supabase
    .from("bookings")
    .select("id, start_utc, end_utc")
    .eq("practitioner_id", practitionerId)
    .in("status", ["pending", "confirmed"]);

  if (error) {
    console.error("getOwnBookingsWithPractitioner failed:", error);
    return [];
  }

  return (data ?? []).map((b) => ({
    id: b.id,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
  }));
}

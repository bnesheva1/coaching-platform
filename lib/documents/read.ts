import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionDocumentSlot } from "@/components/bookings/SessionDocuments";

export type BookingDocumentSlots = { client: SessionDocumentSlot; practitioner: SessionDocumentSlot };

// Loads the current document slot metadata for a set of bookings, keyed
// by booking id. RLS restricts the rows to bookings the caller is a party
// to, so passing the caller's user client is sufficient — no id filtering
// beyond the `in (…)` narrowing. storage_path is grant-excluded and never
// selected here; downloads mint a signed URL on demand instead.
export async function getSessionDocumentSlots(
  supabase: SupabaseClient,
  bookingIds: string[],
): Promise<Map<string, BookingDocumentSlots>> {
  const map = new Map<string, BookingDocumentSlots>();
  if (bookingIds.length === 0) return map;

  const { data, error } = await supabase
    .from("session_documents")
    .select("booking_id, side, file_name, byte_size, uploaded_at")
    .in("booking_id", bookingIds);

  if (error) {
    // Resilient to the migration not being applied yet: fall back to an
    // empty map so the bookings page still renders its base data.
    console.error("getSessionDocumentSlots failed", { error });
    return map;
  }

  for (const row of data ?? []) {
    const entry = map.get(row.booking_id) ?? { client: null, practitioner: null };
    const slot: SessionDocumentSlot = {
      fileName: row.file_name,
      byteSize: row.byte_size,
      uploadedAt: row.uploaded_at,
    };
    if (row.side === "client") entry.client = slot;
    else entry.practitioner = slot;
    map.set(row.booking_id, entry);
  }
  return map;
}

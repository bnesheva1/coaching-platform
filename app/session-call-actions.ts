"use server";

import { createClient } from "@/lib/supabase/server";
import { POST_SESSION_GRACE_MS } from "@/lib/video/sessionWindow";

export type CallPromptSession = {
  bookingId: string;
  startUtc: string;
  endUtc: string;
  counterpartName: string;
  serviceName: string;
};

// How far ahead a session is surfaced to the client. The client itself only
// SHOWS the prompt from start-5min, but fetching earlier means the data is
// already in hand when that moment arrives (rather than waiting on a poll).
const LOOKAHEAD_MS = 60 * 60 * 1000;

// The authed user's single current-or-imminent online session, for either
// role. Returned while now is within [start - LOOKAHEAD, end + grace]; the
// client narrows to the exact show window. Null when logged out or nothing
// is near. Callable from the root layout (server) and re-polled from the
// client prompt.
export async function getImminentCallSession(): Promise<CallPromptSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const now = Date.now();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, practitioner_id, client_id, service_name, start_utc, end_utc")
    .eq("delivery_type", "online")
    .eq("status", "confirmed")
    // RLS already restricts to the caller's own bookings; this scopes to
    // rows where they're actually a party (either side).
    .or(`client_id.eq.${user.id},practitioner_id.eq.${user.id}`)
    .gt("end_utc", new Date(now - POST_SESSION_GRACE_MS).toISOString())
    .lt("start_utc", new Date(now + LOOKAHEAD_MS).toISOString())
    .order("start_utc", { ascending: true })
    .limit(1);

  const b = bookings?.[0];
  if (!b) return null;

  const counterpartId = b.client_id === user.id ? b.practitioner_id : b.client_id;
  const { data: counterpart } = await supabase.from("profiles").select("display_name").eq("id", counterpartId).single();

  return {
    bookingId: b.id,
    startUtc: b.start_utc,
    endUtc: b.end_utc,
    counterpartName: counterpart?.display_name ?? "",
    serviceName: b.service_name ?? "",
  };
}

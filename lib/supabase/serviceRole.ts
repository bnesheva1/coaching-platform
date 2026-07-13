import { createClient } from "@supabase/supabase-js";

// The one client shape used outside a normal user session: cron/batch
// jobs have no cookie-based session to read (lib/supabase/server.ts
// doesn't apply), and need to bypass RLS entirely to act across every
// user's rows. Deliberately isolated to callers that are themselves
// isolated, service-role-only modules (lib/email/reminders.ts,
// lib/bookings/completePastBookings.ts) — no ordinary request path
// should ever reach for this.
export function createServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

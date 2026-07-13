import { NextResponse } from "next/server";
import { sendReminderBatch } from "@/lib/email/reminders";
import { completePastBookings } from "@/lib/bookings/completePastBookings";

// Vercel's standard cron-protection mechanism: set CRON_SECRET as an
// env var (locally AND in the Vercel project dashboard — Vercel's
// scheduler runs in their infrastructure, not this app's, so it reads
// the secret from its own config to attach this header). Vercel
// automatically sends `Authorization: Bearer <CRON_SECRET>` on every
// invocation it makes to a configured cron route. Anyone hitting this
// URL directly without that exact header is rejected before any data
// is touched — only Vercel's own scheduler knows the secret.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Fail closed if CRON_SECRET isn't configured at all — without this
  // check, an unset env var would make the comparison below match the
  // literal string "Bearer undefined", which is a genuine bypass, not
  // just a hypothetical one.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Completion runs first: purely a bookkeeping ordering (it and the
  // reminder batch touch disjoint booking sets — reminders only look at
  // a future 12-36h window, completion only looks at already-past
  // bookings — so there's no interaction risk either way), but it means
  // a booking that just completed is reflected in state before anything
  // else in this invocation runs.
  const completionResult = await completePastBookings();
  const reminderResult = await sendReminderBatch();
  return NextResponse.json({ ...completionResult, ...reminderResult });
}

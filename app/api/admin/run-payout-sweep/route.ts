import { NextResponse } from "next/server";
import { runPayoutReleaseSweep } from "@/lib/payments/stripe/transfer";

// Manual trigger for the payout-release sweep, isolated from the bundled daily
// cron (so running it never fires reminder emails etc.). Same CRON_SECRET guard
// as the cron. Useful operationally — release due payouts on demand between the
// daily runs (especially before the sweep gets its own more-frequent cron on
// Vercel Pro) — and it's the isolated entry point the verify script drives.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runPayoutReleaseSweep();
  return NextResponse.json(summary);
}

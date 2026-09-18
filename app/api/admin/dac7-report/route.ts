import { NextResponse } from "next/server";
import { buildDac7QuarterlyReport } from "@/lib/tax/dac7Report";

// DAC7 quarterly aggregation export — admin/ops only, NOT public. Same CRON_SECRET
// guard as the payout sweep (server-to-server / operator use). Returns the
// per-practitioner-per-quarter breakdown as JSON for inspection — this is the
// "can we compute the numbers" step, not the NRA filing format.
//
//   GET /api/admin/dac7-report?year=2026   (Authorization: Bearer $CRON_SECRET)
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearParam = new URL(request.url).searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const report = await buildDac7QuarterlyReport(year);
  return NextResponse.json(report);
}

import { NextResponse } from "next/server";
import { forceCloseStaleRooms } from "@/lib/video/forceCloseStaleRooms";

// Manual, on-demand leaked-room sweep — run any time, independent of the
// daily cron (which is the whole point: closing rooms must not depend on a
// scheduled job that may not fire).
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     https://<host>/api/admin/close-stale-rooms
//
// Same CRON_SECRET gate as the cron route (a shared secret you control),
// failing closed if it isn't configured. POST because it mutates.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await forceCloseStaleRooms();
  return NextResponse.json(result);
}

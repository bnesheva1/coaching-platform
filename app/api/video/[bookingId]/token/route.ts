import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, videoTokenLimiter } from "@/lib/rate-limit";
import { issueVideoJoinToken } from "@/lib/video";

// Mints a fresh, time-limited LiveKit join token for a booking the caller
// is party to. All authorization lives in issueVideoJoinToken (via the
// get_my_booking_video_access RPC) — a user can only get a token for an
// online, confirmed booking they're on, and only inside the session
// window. This handler adds the two route-level concerns: an auth check
// for the rate-limit key, and the per-user-per-booking rate limit your
// security spec calls for.
export async function POST(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { success, retryAfterSeconds } = await checkRateLimit(videoTokenLimiter, `${user.id}:${bookingId}`);
  if (!success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const result = await issueVideoJoinToken(bookingId);
  if (!result.ok) {
    // forbidden -> 403 (not a party / not online / not confirmed); the
    // window reasons (too_early/too_late) are 403 too — the caller may be
    // legitimate but the room isn't joinable yet/anymore. The reason is
    // returned so the join UI can show the right message.
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }

  return NextResponse.json({ token: result.token, url: result.url, expiresAt: result.expiresAt });
}

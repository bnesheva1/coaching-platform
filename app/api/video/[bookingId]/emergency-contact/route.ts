import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, videoFallbackLimiter } from "@/lib/rate-limit";
import { revealEmergencyContact } from "@/lib/video";
import { sendEmergencyContactRevealedNotice } from "@/lib/email";

// The "having trouble connecting" fallback: reveals the practitioner's
// emergency contact to the CLIENT during an active session window, if one
// is set and not revoked for this booking. Every reveal is logged and
// flips the session to manual review (all inside the RPC). Eligibility is
// entirely the RPC's job; this handler adds the auth check for the
// rate-limit key and the tight per-user-per-booking limit — each reveal
// exposes personal contact data, so it's deliberately rate-limited.
export async function POST(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { success, retryAfterSeconds } = await checkRateLimit(videoFallbackLimiter, `${user.id}:${bookingId}`);
  if (!success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const result = await revealEmergencyContact(bookingId);
  if (!result.ok) {
    // Not eligible (not the client, outside the window, revoked, or none
    // set) — a single opaque status so this can't be used to probe whether
    // a practitioner has an emergency contact configured.
    return NextResponse.json({ error: "unavailable" }, { status: 404 });
  }

  // Notify the practitioner post-response (they get an email; the reveal
  // is already logged in video_fallback_reveals, which the practitioner
  // dashboard surfaces as a marker). after() so the client's contact
  // reveal isn't held up by the email send.
  after(async () => {
    try {
      await sendEmergencyContactRevealedNotice(bookingId);
    } catch (err) {
      console.error("emergency-contact route: practitioner notice failed", { bookingId, err });
    }
  });

  return NextResponse.json({ contact: result.contact });
}

import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Supabase's DEFAULT email templates — including the dashboard's "Send recovery"
// (Auth → Users) and the "Reset Password" template — link to a token_hash + type
// verification, NOT the implicit #fragment link that admin.generateLink()
// produces. The app's own /forgot-password flow and ResetPasswordForm's
// fragment handling are UNTOUCHED; this route only adds the missing shape.
//
// It verifies the token_hash SERVER-SIDE (verifyOtp), which establishes the
// session in cookies, then hands off to the SAME /reset-password screen. That
// screen's existing logic — "no #fragment → fall back to the current session" —
// then finds this cookie session and shows the set-password form, and the
// existing resetPassword action (which reads the cookie session) completes it.
// A failed/expired token sets no session, so /reset-password lands on the exact
// "link expired" state the app already shows.
//
// GET only (email links are GET). The redirect destination is a HARDCODED
// internal path built from this request's own origin — no caller-supplied
// redirect (`next`, `redirect_to`, …) is ever honored, so this cannot be turned
// into an open redirect.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Always the app's own reset screen, same origin — never a value from the URL.
  const destination = new URL("/reset-password", request.url);

  if (tokenHash && type) {
    const supabase = await createClient();
    // On success this writes the session cookies onto the response; on failure
    // (expired/used/superseded token) it doesn't, and /reset-password shows its
    // existing expired state. The token itself is never logged.
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      console.error("/auth/confirm: verifyOtp failed", { type, message: error.message });
    }
  }

  return NextResponse.redirect(destination);
}

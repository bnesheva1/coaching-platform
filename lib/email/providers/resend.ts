import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";
import { type ConnectionResult, errorMessage } from "@/lib/health/types";

// Lazily instantiated on first actual send, not at module load. The
// Resend SDK throws *synchronously* in its constructor if given no API
// key — and Next.js evaluates this module during its build-time "collect
// page data" step for every route that transitively imports it (e.g.
// the reminders cron route), even though that route's handler never
// runs at build time. Eager construction meant merely IMPORTING this
// file crashed the production build outright whenever RESEND_API_KEY
// wasn't present in that specific build context (confirmed live: this
// broke every Vercel deployment from the cron-reminders commit onward).
// Deferring construction to first real use means a still-missing key
// only ever surfaces as a normal runtime SendEmailResult failure below,
// never a build failure.
let resend: Resend | null = null;
function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export class ResendEmailProvider implements EmailProvider {
  async send({ to, subject, react }: SendEmailInput): Promise<SendEmailResult> {
    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
      // Fail closed on missing config, not fail open — sending from an
      // unintended address (or Resend's own default) is worse than not
      // sending at all.
      return { success: false, error: "RESEND_FROM_EMAIL is not configured" };
    }

    // Test/staging recipient redirect. While `from` is Resend's shared
    // onboarding@resend.dev (or any not-yet-verified domain), Resend only
    // DELIVERS to the account owner's own address and 422s every other
    // recipient. Setting DEV_EMAIL_OVERRIDE routes EVERY email to that one
    // address instead, so real flows (bookings, reminders, confirmations, the
    // alert digest, the contact form) can be exercised end-to-end before a
    // sending domain is verified. Applied HERE — the single send chokepoint
    // every path funnels through — so no path can bypass it. Unset it once a
    // real RESEND_FROM_EMAIL domain is verified and the app sends to real
    // recipients again.
    const override = process.env.DEV_EMAIL_OVERRIDE?.trim();
    const recipient = override || to;
    // When redirected, keep the intended recipient visible in the subject so a
    // shared test inbox can tell who each message was actually meant for.
    const finalSubject = override && override !== to ? `[→ ${to}] ${subject}` : subject;

    try {
      const result = await getResendClient().emails.send({ from, to: recipient, subject: finalSubject, react });
      if (result.error) {
        // Surface Resend's full reason (name + message), not just the message —
        // a bare "Invalid `to` field" hides that it's a validation_error/422.
        return { success: false, error: `${result.error.name}: ${result.error.message}` };
      }
      return { success: true };
    } catch (error) {
      // Never let a Resend-specific error type leak past this module —
      // the caller only ever sees a plain SendEmailResult.
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error sending email",
      };
    }
  }

  // Lists domains — a cheap authenticated GET that confirms RESEND_API_KEY is
  // valid without sending anything. Confirms the credential works; it can't
  // confirm the app will actually deliver (that also depends on RESEND_FROM_EMAIL
  // and the sandbox-sender restriction, surfaced separately as config state).
  async checkConnection(): Promise<ConnectionResult> {
    if (!process.env.RESEND_API_KEY) {
      return { ok: false, detail: "RESEND_API_KEY is not configured" };
    }
    try {
      const { error } = await getResendClient().domains.list();
      if (error) return { ok: false, detail: "API key rejected", error: error.message };
      return { ok: true, detail: "API key valid" };
    } catch (e) {
      return { ok: false, detail: "Could not reach Resend", error: errorMessage(e) };
    }
  }
}

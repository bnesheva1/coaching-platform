import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";

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

    try {
      const result = await getResendClient().emails.send({ from, to, subject, react });
      if (result.error) {
        return { success: false, error: result.error.message };
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
}

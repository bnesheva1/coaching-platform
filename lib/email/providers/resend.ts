import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "../types";

// Instantiated once at module scope and never exported — mirrors
// lib/rate-limit.ts's Redis client. The rest of the app never sees this
// object; it only ever calls through lib/email/index.ts.
const resend = new Resend(process.env.RESEND_API_KEY);

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
      const result = await resend.emails.send({ from, to, subject, react });
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

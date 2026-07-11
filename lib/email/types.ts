import type { ReactElement } from "react";

// The seam: everything outside lib/email/providers/ talks to this
// interface, never to a specific provider's SDK. Swapping Resend for
// another provider later means writing one new file implementing this
// interface and changing one line in lib/email/index.ts — nothing else
// in the app touches Resend or knows it exists.
export type SendEmailInput = {
  to: string;
  subject: string;
  react: ReactElement;
};

export type SendEmailResult = { success: true } | { success: false; error: string };

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

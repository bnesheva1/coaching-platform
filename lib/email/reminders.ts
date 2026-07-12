import { createClient } from "@supabase/supabase-js";
import { provider, translator, normalizeLocale, formatSessionTime } from "./shared";
import type { SendEmailResult } from "./types";
import { ReminderEmail } from "./templates/ReminderEmail";

// A 24-hour-wide band centered on the 24h mark — deliberately much
// wider than the daily cron interval. A booking passes through this
// window on more than one run at daily cadence, but the per-recipient
// markers (not the window's edges) are what actually prevent a
// double-send — see the migration and sendReminderBatch below. Widening
// this beyond one day of margin is what makes the job tolerant of an
// occasional missed/late run without ever silently skipping a booking
// that still has enough lead time to matter.
const WINDOW_START_HOURS = 12;
const WINDOW_END_HOURS = 36;

// Cheap safety cap against a pathological backlog (e.g. a bug leaving
// many bookings unreminded) — not expected to matter at current scale.
const BATCH_LIMIT = 200;

type ReminderBatchRow = {
  booking_id: string;
  client_reminder_sent_at: string | null;
  practitioner_reminder_sent_at: string | null;
  client_email: string | null;
  client_display_name: string | null;
  client_locale: string;
  client_timezone: string | null;
  practitioner_email: string | null;
  practitioner_display_name: string | null;
  practitioner_locale: string;
  practitioner_timezone: string;
  service_name: string;
  start_utc: string;
  end_utc: string;
};

export type ReminderBatchResult = {
  bookingsChecked: number;
  remindersSent: number;
  remindersFailed: number;
};

// No logged-in user is behind a cron invocation, so the cookie-based
// client (lib/supabase/server.ts) doesn't apply here — there's no
// session to read. This is the one place in the app a service-role
// client is used, deliberately isolated to this file: it bypasses RLS
// entirely, which is exactly what a "read every user's due bookings"
// batch job needs and no ordinary request ever should have.
function createServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

async function sendReminderTo(params: {
  email: string;
  displayName: string | null;
  locale: string;
  timezone: string | null;
  includeUtcBracket: boolean;
  counterpartyName: string | null;
  serviceName: string;
  startUtc: string;
  bodyKey: "reminderBodyClient" | "reminderBodyPractitioner";
}): Promise<SendEmailResult> {
  const locale = normalizeLocale(params.locale);
  const t = translator(locale);
  const sessionTime = formatSessionTime(params.startUtc, params.timezone, locale, params.includeUtcBracket);

  return provider.send({
    to: params.email,
    subject: t("reminderSubject", { serviceName: params.serviceName }),
    react: ReminderEmail({
      heading: t("reminderHeading"),
      body: t(params.bodyKey, {
        recipientName: params.displayName ?? "",
        counterpartyName: params.counterpartyName ?? "",
        serviceName: params.serviceName,
        sessionTime,
      }),
      footer: t("footer"),
    }),
  });
}

// Sends the 24h reminder to whichever party (or both) hasn't been sent
// one yet, for every still-active booking in the window. Never throws
// — a bad recipient or a Resend outage is logged and the loop moves on,
// same contract as the rest of lib/email/. Each recipient's marker is
// only set immediately after THEIR OWN successful send, independent of
// the other party's outcome — this is what makes a partial failure
// retry only the half that actually failed, next run, without
// re-sending to the half that already succeeded.
export async function sendReminderBatch(): Promise<ReminderBatchResult> {
  const supabase = createServiceRoleClient();
  const now = Date.now();
  const windowStart = new Date(now + WINDOW_START_HOURS * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + WINDOW_END_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc("get_reminder_batch", {
    window_start: windowStart,
    window_end: windowEnd,
    batch_limit: BATCH_LIMIT,
  });

  if (error) {
    console.error("sendReminderBatch: get_reminder_batch failed", { error });
    return { bookingsChecked: 0, remindersSent: 0, remindersFailed: 0 };
  }

  const rows = (data ?? []) as ReminderBatchRow[];
  let remindersSent = 0;
  let remindersFailed = 0;

  for (const row of rows) {
    if (!row.client_reminder_sent_at) {
      if (!row.client_email) {
        console.error("sendReminderBatch: client_email is null, skipping", { bookingId: row.booking_id });
        remindersFailed++;
      } else {
        try {
          const result = await sendReminderTo({
            email: row.client_email,
            displayName: row.client_display_name,
            locale: row.client_locale,
            timezone: row.client_timezone,
            includeUtcBracket: true,
            counterpartyName: row.practitioner_display_name,
            serviceName: row.service_name,
            startUtc: row.start_utc,
            bodyKey: "reminderBodyClient",
          });
          if (result.success) {
            await supabase
              .from("bookings")
              .update({ client_reminder_sent_at: new Date().toISOString() })
              .eq("id", row.booking_id);
            remindersSent++;
          } else {
            console.error("sendReminderBatch: client reminder failed", {
              bookingId: row.booking_id,
              recipient: row.client_email,
              error: result.error,
            });
            remindersFailed++;
          }
        } catch (err) {
          console.error("sendReminderBatch: client reminder threw", { bookingId: row.booking_id, error: err });
          remindersFailed++;
        }
      }
    }

    if (!row.practitioner_reminder_sent_at) {
      if (!row.practitioner_email) {
        console.error("sendReminderBatch: practitioner_email is null, skipping", { bookingId: row.booking_id });
        remindersFailed++;
      } else {
        try {
          const result = await sendReminderTo({
            email: row.practitioner_email,
            displayName: row.practitioner_display_name,
            locale: row.practitioner_locale,
            timezone: row.practitioner_timezone,
            includeUtcBracket: false,
            counterpartyName: row.client_display_name,
            serviceName: row.service_name,
            startUtc: row.start_utc,
            bodyKey: "reminderBodyPractitioner",
          });
          if (result.success) {
            await supabase
              .from("bookings")
              .update({ practitioner_reminder_sent_at: new Date().toISOString() })
              .eq("id", row.booking_id);
            remindersSent++;
          } else {
            console.error("sendReminderBatch: practitioner reminder failed", {
              bookingId: row.booking_id,
              recipient: row.practitioner_email,
              error: result.error,
            });
            remindersFailed++;
          }
        } catch (err) {
          console.error("sendReminderBatch: practitioner reminder threw", { bookingId: row.booking_id, error: err });
          remindersFailed++;
        }
      }
    }
  }

  return { bookingsChecked: rows.length, remindersSent, remindersFailed };
}

import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { provider, translator, footerText, normalizeLocale, formatSessionTime, type Locale } from "@/lib/email/shared";
import { SessionDocumentExpiryEmail } from "@/lib/email/templates/SessionDocumentExpiryEmail";
import { SESSION_DOCUMENT_RETENTION_DAYS, SESSION_DOCUMENT_RETENTION_WARN_DAYS } from "./config";

// Retention sweep for session documents, folded into the daily cron
// (Vercel Hobby = one cron). Two independent passes, both service-role
// (they cross user boundaries and touch grant-excluded columns) and both
// best-effort — a bad recipient or a Resend outage is logged and the loop
// moves on, same contract as lib/email/reminders.ts.
//
// The retention clock is anchored to the SESSION: a document is deleted
// SESSION_DOCUMENT_RETENTION_DAYS after booking.end_utc. Both slots of a
// booking therefore share one deletion date, and a contract uploaded
// before a consultation survives the consultation.

const BUCKET = "session-documents";
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

const INTL_LOCALES: Record<Locale, string> = { en: "en-US", bg: "bg-BG" };

export type DocumentRetentionResult = {
  documentsWarned: number;
  documentsPurged: number;
};

function formatDeletionDate(deletionAt: Date, timezone: string | null, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: "full",
    timeZone: timezone ?? "UTC",
  }).format(deletionAt);
}

type ExpiringRow = {
  document_id: string;
  booking_id: string;
  side: string;
  file_name: string;
  start_utc: string;
  end_utc: string;
  service_name: string;
  client_email: string | null;
  client_display_name: string | null;
  client_locale: string;
  client_timezone: string | null;
  practitioner_email: string | null;
  practitioner_display_name: string | null;
  practitioner_locale: string;
  practitioner_timezone: string;
};

async function sendExpiryTo(params: {
  email: string;
  displayName: string | null;
  locale: string;
  timezone: string | null;
  includeUtcBracket: boolean;
  serviceName: string;
  startUtc: string;
  deletionAt: Date;
}): Promise<boolean> {
  const locale = normalizeLocale(params.locale);
  const t = translator(locale);
  const sessionTime = formatSessionTime(params.startUtc, params.timezone, locale, params.includeUtcBracket);
  const deletionDate = formatDeletionDate(params.deletionAt, params.timezone, locale);

  const result = await provider.send({
    to: params.email,
    subject: t("docExpirySubject", { serviceName: params.serviceName }),
    react: SessionDocumentExpiryEmail({
      heading: t("docExpiryHeading"),
      body: t("docExpiryBody", {
        recipientName: params.displayName ?? "",
        serviceName: params.serviceName,
        sessionTime,
        deletionDate,
      }),
      footer: footerText(locale),
    }),
  });
  return result.success;
}

// Warn both parties before a booking's documents are deleted. deletion_at
// = end_utc + RETENTION_DAYS; "within WARN_DAYS" is expressed as an
// end_utc band so the SQL never needs the retention-day count. One email
// per party per booking; retention_warned_at (per document, reset on a
// fresh upload) is the idempotency marker.
export async function warnExpiringSessionDocuments(): Promise<{ documentsWarned: number }> {
  const supabase = createServiceRoleClient();
  const now = Date.now();
  const endUtcFrom = new Date(now - SESSION_DOCUMENT_RETENTION_DAYS * DAY_MS).toISOString();
  const endUtcTo = new Date(now + (SESSION_DOCUMENT_RETENTION_WARN_DAYS - SESSION_DOCUMENT_RETENTION_DAYS) * DAY_MS).toISOString();

  const { data, error } = await supabase.rpc("get_expiring_session_documents_batch", {
    end_utc_from: endUtcFrom,
    end_utc_to: endUtcTo,
    batch_limit: BATCH_LIMIT,
  });
  if (error) {
    console.error("warnExpiringSessionDocuments: batch query failed", { error });
    return { documentsWarned: 0 };
  }

  const rows = (data ?? []) as ExpiringRow[];

  // Group documents by booking — both parties are warned once, listing
  // whatever is expiring on that booking.
  const byBooking = new Map<string, ExpiringRow[]>();
  for (const row of rows) {
    const list = byBooking.get(row.booking_id) ?? [];
    list.push(row);
    byBooking.set(row.booking_id, list);
  }

  const warnedIds: string[] = [];
  for (const [, group] of byBooking) {
    const ref = group[0];
    const deletionAt = new Date(new Date(ref.end_utc).getTime() + SESSION_DOCUMENT_RETENTION_DAYS * DAY_MS);

    if (ref.client_email) {
      try {
        await sendExpiryTo({
          email: ref.client_email,
          displayName: ref.client_display_name,
          locale: ref.client_locale,
          timezone: ref.client_timezone,
          includeUtcBracket: true,
          serviceName: ref.service_name,
          startUtc: ref.start_utc,
          deletionAt,
        });
      } catch (err) {
        console.error("warnExpiringSessionDocuments: client warn threw", { bookingId: ref.booking_id, err });
      }
    } else {
      console.error("warnExpiringSessionDocuments: client_email null, skipping", { bookingId: ref.booking_id });
    }

    if (ref.practitioner_email) {
      try {
        await sendExpiryTo({
          email: ref.practitioner_email,
          displayName: ref.practitioner_display_name,
          locale: ref.practitioner_locale,
          timezone: ref.practitioner_timezone,
          includeUtcBracket: false,
          serviceName: ref.service_name,
          startUtc: ref.start_utc,
          deletionAt,
        });
      } catch (err) {
        console.error("warnExpiringSessionDocuments: practitioner warn threw", { bookingId: ref.booking_id, err });
      }
    } else {
      console.error("warnExpiringSessionDocuments: practitioner_email null, skipping", { bookingId: ref.booking_id });
    }

    // Mark every document in this booking as warned, whatever the send
    // outcome — the marker is per-booking-once by design, so we don't
    // re-warn (and re-spam the reachable party) on the next daily run.
    for (const row of group) warnedIds.push(row.document_id);
  }

  if (warnedIds.length > 0) {
    const { error: markError } = await supabase
      .from("session_documents")
      .update({ retention_warned_at: new Date().toISOString() })
      .in("id", warnedIds);
    if (markError) console.error("warnExpiringSessionDocuments: mark failed", { markError });
  }

  return { documentsWarned: warnedIds.length };
}

// Permanently delete documents past their retention window: remove the
// object, delete the live slot, and record a 'deleted_retention' event
// that outlives the file (so a later reviewer still sees a document was
// exchanged — who, when, name, size — without the platform holding it).
export async function purgeExpiredSessionDocuments(): Promise<{ documentsPurged: number }> {
  const supabase = createServiceRoleClient();
  // deletion_at (= end_utc + RETENTION_DAYS) has passed ⟺ end_utc is
  // older than RETENTION_DAYS ago.
  const endUtcBefore = new Date(Date.now() - SESSION_DOCUMENT_RETENTION_DAYS * DAY_MS).toISOString();

  const { data, error } = await supabase.rpc("get_purgeable_session_documents", {
    end_utc_before: endUtcBefore,
    batch_limit: BATCH_LIMIT,
  });
  if (error) {
    console.error("purgeExpiredSessionDocuments: batch query failed", { error });
    return { documentsPurged: 0 };
  }

  const rows = (data ?? []) as {
    document_id: string;
    booking_id: string;
    side: string;
    storage_path: string;
    file_name: string;
    byte_size: number;
    mime_type: string;
  }[];

  let purged = 0;
  for (const row of rows) {
    // Remove the object first (idempotent — a missing object is not an
    // error), then the row. If either fails, leave the row intact so the
    // next run retries; the event is only logged after a clean delete, so
    // no duplicate audit rows.
    const { error: rmError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
    if (rmError) {
      console.error("purgeExpiredSessionDocuments: storage remove failed", { path: row.storage_path, rmError });
      continue;
    }

    const { error: delError } = await supabase.from("session_documents").delete().eq("id", row.document_id);
    if (delError) {
      console.error("purgeExpiredSessionDocuments: row delete failed", { documentId: row.document_id, delError });
      continue;
    }

    const { error: eventError } = await supabase.from("session_document_events").insert({
      booking_id: row.booking_id,
      side: row.side,
      actor_id: null,
      action: "deleted_retention",
      file_name: row.file_name,
      byte_size: row.byte_size,
      mime_type: row.mime_type,
    });
    if (eventError) console.error("purgeExpiredSessionDocuments: event log insert failed", { documentId: row.document_id, eventError });

    purged++;
  }

  return { documentsPurged: purged };
}

// Convenience wrapper the cron calls: warn first (so a document about to
// be purged isn't warned about in the same run it disappears), then purge.
export async function runSessionDocumentRetention(): Promise<DocumentRetentionResult> {
  const { documentsWarned } = await warnExpiringSessionDocuments();
  const { documentsPurged } = await purgeExpiredSessionDocuments();
  return { documentsWarned, documentsPurged };
}

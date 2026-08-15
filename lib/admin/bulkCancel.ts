import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { refundBookingPayment } from "@/lib/payments";
import { sendCancellationNoticeEmail, sendBulkCancellationSummaryEmail, normalizeLocale } from "@/lib/email";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type PreviewBooking = {
  bookingId: string;
  clientName: string;
  startUtc: string;
  amountCents: number | null; // succeeded payment amount, or null (no payment)
  currency: string | null;
  alreadyRefunded: boolean;
};

export type BulkCancelPreview = {
  practitionerId: string;
  bookings: PreviewBooking[];
  count: number;
  totalRefundableCents: number;
  currency: string | null;
  noPaymentCount: number;
};

export type BookingOutcome = {
  bookingId: string;
  clientName: string;
  startUtc: string;
  outcome: "refunded" | "refund_failed" | "no_payment" | "already_refunded";
  amountCents: number | null;
};

export type BulkCancelResult = {
  batchId: string;
  complete: boolean;
  totalRefundedCents: number;
  currency: string | null;
  outcomes: BookingOutcome[];
  counts: { refunded: number; refundFailed: number; noPayment: number; alreadyRefunded: number };
};

// The set of a practitioner's still-active upcoming bookings, with the client
// name and the succeeded/refunded payment for each. The single read the preview
// and the executor both build on — active-status allow-list means an
// already-cancelled booking naturally falls out (re-run safety, for free).
async function loadUpcoming(supabase: ServiceClient, practitionerId: string) {
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, client_id, start_utc, cancellation_notice_sent_at")
    .eq("practitioner_id", practitionerId)
    .in("status", ["pending", "confirmed"])
    .gt("start_utc", new Date().toISOString())
    .order("start_utc", { ascending: true });
  const rows = bookings ?? [];
  if (rows.length === 0) return { rows, clientName: new Map<string, string>(), payment: new Map<string, { amountCents: number; currency: string; status: string }>() };

  const clientIds = [...new Set(rows.map((b) => b.client_id as string))];
  const bookingIds = rows.map((b) => b.id as string);
  const [{ data: profiles }, { data: payments }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", clientIds),
    supabase.from("payments").select("booking_id, amount_cents, currency, status").in("booking_id", bookingIds).in("status", ["succeeded", "refunded"]),
  ]);
  const clientName = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string) ?? "—"]));
  const payment = new Map(
    (payments ?? []).map((p) => [p.booking_id as string, { amountCents: p.amount_cents as number, currency: p.currency as string, status: p.status as string }]),
  );
  return { rows, clientName, payment };
}

// Read-only. Exactly what will happen, before anything runs.
export async function previewBulkCancel(practitionerId: string): Promise<BulkCancelPreview> {
  const supabase = createServiceRoleClient();
  const { rows, clientName, payment } = await loadUpcoming(supabase, practitionerId);

  const bookings: PreviewBooking[] = rows.map((b) => {
    const p = payment.get(b.id as string);
    return {
      bookingId: b.id as string,
      clientName: clientName.get(b.client_id as string) ?? "—",
      startUtc: b.start_utc as string,
      amountCents: p ? p.amountCents : null,
      currency: p ? p.currency : null,
      alreadyRefunded: p?.status === "refunded",
    };
  });
  const refundable = bookings.filter((b) => b.amountCents != null && !b.alreadyRefunded);
  return {
    practitionerId,
    bookings,
    count: bookings.length,
    totalRefundableCents: refundable.reduce((s, b) => s + (b.amountCents ?? 0), 0),
    currency: refundable[0]?.currency ?? bookings.find((b) => b.currency)?.currency ?? null,
    noPaymentCount: bookings.filter((b) => b.amountCents == null).length,
  };
}

// Executes the cancel-and-refund. Idempotent and re-runnable end to end:
//   - each booking processed independently (one failure never halts the rest)
//   - EMAIL first (guarded by cancellation_notice_sent_at), so no client is ever
//     cancelled without notice AND none is emailed twice on a re-run
//   - REFUND via the existing seam (full commission reversal, idempotent, raises
//     failed_refund itself on rejection)
//   - CANCEL last (status → cancelled_by_admin, stamped with the batch)
// A timed-out run is finished by re-running: already-cancelled bookings fall out
// of the active selection, already-refunded payments aren't refunded again, and
// already-emailed clients aren't emailed again. The practitioner summary is sent
// exactly once, when the operation completes.
export async function executeBulkCancel(
  practitionerId: string,
  reason: string,
  initiatedBy: string,
): Promise<BulkCancelResult> {
  const supabase = createServiceRoleClient();

  // Resume the practitioner's open operation if there is one (a prior run timed
  // out); otherwise start one. The batch's OWN reason is authoritative for every
  // client email, so the wording stays consistent across runs.
  const { data: openBatch } = await supabase
    .from("bulk_cancellations")
    .select("id, reason, practitioner_notified_at")
    .eq("practitioner_id", practitionerId)
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let batch = openBatch;
  if (!batch) {
    const { data: created } = await supabase
      .from("bulk_cancellations")
      .insert({ practitioner_id: practitionerId, initiated_by: initiatedBy, reason })
      .select("id, reason, practitioner_notified_at")
      .single();
    batch = created;
  }
  if (!batch) throw new Error("bulkCancel: could not open a batch");
  const batchId = batch.id as string;
  const effectiveReason = (batch.reason as string) || reason;

  const { rows, clientName, payment } = await loadUpcoming(supabase, practitionerId);

  const outcomes: BookingOutcome[] = [];
  let totalRefundedCents = 0;
  let currency: string | null = null;
  const counts = { refunded: 0, refundFailed: 0, noPayment: 0, alreadyRefunded: 0 };

  for (const b of rows) {
    const bookingId = b.id as string;
    const name = clientName.get(b.client_id as string) ?? "—";
    const p = payment.get(bookingId);

    // 1. EMAIL FIRST — idempotent via the per-booking marker.
    if (!b.cancellation_notice_sent_at) {
      const sent = await sendCancellationNoticeEmail(bookingId, "platform", effectiveReason);
      if (sent) {
        await supabase.from("bookings").update({ cancellation_notice_sent_at: new Date().toISOString() }).eq("id", bookingId);
      }
    }

    // 2. REFUND — full + commission reversal; idempotent; raises failed_refund itself.
    let outcome: BookingOutcome["outcome"];
    if (!p) {
      outcome = "no_payment";
      counts.noPayment++;
    } else if (p.status === "refunded") {
      outcome = "already_refunded";
      counts.alreadyRefunded++;
    } else {
      const r = await refundBookingPayment(bookingId);
      if (r.refunded) {
        outcome = "refunded";
        counts.refunded++;
        totalRefundedCents += p.amountCents;
        currency = p.currency;
      } else if (r.reason === "not_applicable") {
        outcome = "no_payment";
        counts.noPayment++;
      } else {
        outcome = "refund_failed"; // the failed_refund alert was already raised inside the refund path
        counts.refundFailed++;
      }
    }

    // 3. CANCEL LAST — only from an active status (idempotent), stamped with the batch.
    await supabase
      .from("bookings")
      .update({ status: "cancelled_by_admin", cancellation_batch_id: batchId })
      .eq("id", bookingId)
      .in("status", ["pending", "confirmed"]);

    outcomes.push({ bookingId, clientName: name, startUtc: b.start_utc as string, outcome, amountCents: p?.amountCents ?? null });
  }

  // Complete when nothing active remains for this practitioner. Send the
  // practitioner summary exactly once (describing the whole operation), then
  // close the batch.
  const { count: stillActive } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", practitionerId)
    .in("status", ["pending", "confirmed"])
    .gt("start_utc", new Date().toISOString());
  const complete = (stillActive ?? 0) === 0;

  if (complete) {
    if (!batch.practitioner_notified_at) {
      await sendBulkCancellationSummaryEmail(practitionerId, batchId, effectiveReason);
      await supabase.from("bulk_cancellations").update({ practitioner_notified_at: new Date().toISOString() }).eq("id", batchId);
    }
    await supabase.from("bulk_cancellations").update({ completed_at: new Date().toISOString() }).eq("id", batchId).is("completed_at", null);
  }

  return { batchId, complete, totalRefundedCents, currency, outcomes, counts };
}

export { normalizeLocale };

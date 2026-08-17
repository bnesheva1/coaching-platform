import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { ensureVideoSession } from "@/lib/video";
import { sendBookingConfirmationEmails, sendImmediatePaymentFailedEmail, normalizeLocale } from "@/lib/email";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
const nowIso = () => new Date().toISOString();

// Creates the off-grid immediate booking (start = the moment it's created — the
// software_provider confirm, or the webhook when payment clears). Same booking
// shape + video session + confirmation emails as a scheduled booking; the only
// difference is the arbitrary start_utc (no 15-minute grid). Shared by the
// confirm action and the payment webhook.
export async function createImmediateBooking(
  svc: ServiceClient,
  req: { client_id: string; practitioner_id: string; service_id: string; request_id: string },
  startUtc: string,
  endUtc: string,
): Promise<string | null> {
  const { data: service } = await svc
    .from("services")
    .select("name, price_cents, currency, delivery_type, delivery_info, phone_number, meeting_link")
    .eq("id", req.service_id)
    .single();
  if (!service) return null;
  const { data: booking, error } = await svc
    .from("bookings")
    .insert({
      practitioner_id: req.practitioner_id,
      client_id: req.client_id,
      service_id: req.service_id,
      immediate_request_id: req.request_id,
      start_utc: startUtc,
      end_utc: endUtc,
      delivery_type: service.delivery_type,
      phone_number: service.phone_number,
      meeting_link: service.meeting_link,
      service_name: service.name,
      price_cents: service.price_cents,
      currency: service.currency,
      delivery_info: service.delivery_info,
    })
    .select("id")
    .single();
  if (error || !booking) {
    console.error("createImmediateBooking: insert failed", { req, error });
    return null;
  }
  if (service.delivery_type === "online") await ensureVideoSession(booking.id as string);
  const { data: client } = await svc.from("profiles").select("locale").eq("id", req.client_id).single();
  await sendBookingConfirmationEmails(booking.id as string, normalizeLocale((client?.locale as string) ?? "bg"));
  return booking.id as string;
}

// Frees a practitioner whose payment window elapsed / was cancelled: releases the
// hold, marks the request payment_failed (guarded — idempotent), re-enables their
// availability with a fresh heartbeat (they were waiting), and tells them.
export async function releaseAndFree(svc: ServiceClient, requestId: string): Promise<void> {
  const { data: req } = await svc
    .from("immediate_requests")
    .update({ status: "payment_failed" })
    .eq("id", requestId)
    .eq("status", "confirmed")
    .select("practitioner_id")
    .maybeSingle();
  if (!req) return; // already resolved (booked in a race, etc.)
  await svc.from("immediate_holds").delete().eq("request_id", requestId);
  await svc
    .from("immediate_presence")
    .update({ available_now: true, last_heartbeat_at: nowIso(), updated_at: nowIso() })
    .eq("practitioner_id", req.practitioner_id as string);
  await sendImmediatePaymentFailedEmail(requestId);
}

// The payment webhook's immediate branch. Only books if the request is still
// 'confirmed' with a live hold (the window hasn't passed and the practitioner is
// still waiting); the session starts at THIS moment (payment clear), off-grid.
// Returns booked:false when the window passed / it raced — the caller refunds,
// since the practitioner has already moved on.
export async function finalizeImmediatePayment(requestId: string): Promise<{ booked: boolean; reason?: string }> {
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("client_id, practitioner_id, service_id, status").eq("id", requestId).single();
  if (!req) return { booked: false, reason: "no_request" };
  if (req.status !== "confirmed") return { booked: false, reason: "not_confirmed" };
  const { data: hold } = await svc.from("immediate_holds").select("expires_at").eq("request_id", requestId).maybeSingle();
  if (!hold || new Date(hold.expires_at as string) <= new Date()) return { booked: false, reason: "expired" };

  // Claim (guarded on confirmed) before creating the booking, so a racing
  // timeout-release can't double-book.
  const { data: claimed } = await svc.from("immediate_requests").update({ status: "booked" }).eq("id", requestId).eq("status", "confirmed").select("id");
  if (!claimed || claimed.length === 0) return { booked: false, reason: "raced" };

  const { data: service } = await svc.from("services").select("duration_minutes").eq("id", req.service_id as string).single();
  const start = new Date();
  const end = new Date(start.getTime() + ((service?.duration_minutes as number) ?? 0) * 60_000);
  await createImmediateBooking(
    svc,
    { client_id: req.client_id as string, practitioner_id: req.practitioner_id as string, service_id: req.service_id as string, request_id: requestId },
    start.toISOString(),
    end.toISOString(),
  );
  await svc.from("immediate_holds").delete().eq("request_id", requestId);
  return { booked: true };
}

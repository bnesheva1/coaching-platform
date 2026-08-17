"use server";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled } from "@/lib/flags";
import { getConnectedAccountId } from "@/lib/payments";
import { createImmediateCheckoutSession } from "@/lib/payments/stripe/checkout";
import { siteOrigin } from "@/lib/siteOrigin";
import { IMMEDIATE_CONFIG } from "./config";
import { computeImmediateFit, computeImmediateAvailability, type ImmediateBlockReason } from "./fit";
import { createImmediateBooking, releaseAndFree } from "./booking";

export type { ImmediateBlockReason } from "./fit";

// Every action opens with this: the feature doesn't exist while the flag is off
// (notFound, not a hidden button), and each is scoped to the right role.
async function gate(role: "practitioner" | "client") {
  if (!(await isEnabled("immediateBooking"))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== role) notFound();
  return user;
}

const nowIso = () => new Date().toISOString();

// ── Presence (practitioner) ─────────────────────────────────────────────────

export type SetAvailableResult = { ok: true } | { ok: false; reason: ImmediateBlockReason };

// Turn "available now" on/off. Notification permission is enforced client-side
// before this is called (the server can't see it); enabling stamps a fresh
// heartbeat so the practitioner is immediately live. Enabling is GATED on
// something actually being bookable right now (§2) — a practitioner must not be
// able to declare themselves available and then silently deliver nothing; the
// caller shows the returned reason and stays off.
export async function setAvailableNow(available: boolean): Promise<SetAvailableResult> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();
  if (available) {
    const avail = await computeImmediateAvailability(user.id);
    if (avail.bookableServiceIds.length === 0) {
      return { ok: false, reason: avail.reason ?? { kind: "blocked" } };
    }
  }
  await svc.from("immediate_presence").upsert(
    { practitioner_id: user.id, available_now: available, last_heartbeat_at: available ? nowIso() : null, updated_at: nowIso() },
    { onConflict: "practitioner_id" },
  );
  return { ok: true };
}

export type InboxRequest = { id: string; clientName: string; serviceName: string; expiresAt: string };

// The unified ~10s tick: refresh the heartbeat (only while available) and return
// the live pending inbox. Lazily lapses anything expired so the inbox and the
// one-live-request index stay honest without a sweep. Returns available:false if
// they've been turned off (the widget then stops ticking).
export async function presenceTick(): Promise<{ available: boolean; requests: InboxRequest[]; staleReason?: ImmediateBlockReason }> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();

  const { data: presence } = await svc.from("immediate_presence").select("available_now").eq("practitioner_id", user.id).maybeSingle();
  if (!presence?.available_now) return { available: false, requests: [] };

  // Staleness (§4): availability can lapse while they're already on — e.g. a
  // scheduled session drew close enough that even the shortest service no longer
  // fits. Auto-switch off (keeping presence honest, so the client-facing marker
  // everywhere stays truthful) and tell them why, rather than leaving them
  // believing they're available when they aren't.
  const avail = await computeImmediateAvailability(user.id);
  if (avail.bookableServiceIds.length === 0) {
    await svc.from("immediate_presence").update({ available_now: false, last_heartbeat_at: null, updated_at: nowIso() }).eq("practitioner_id", user.id);
    return { available: false, requests: [], staleReason: avail.reason ?? undefined };
  }

  await svc.from("immediate_presence").update({ last_heartbeat_at: nowIso() }).eq("practitioner_id", user.id);
  await svc.from("immediate_requests").update({ status: "lapsed" }).eq("practitioner_id", user.id).eq("status", "pending").lt("expires_at", nowIso());

  const { data: reqs } = await svc
    .from("immediate_requests")
    .select("id, client_id, service_id, expires_at")
    .eq("practitioner_id", user.id)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  const rows = reqs ?? [];
  if (rows.length === 0) return { available: true, requests: [] };

  const [{ data: clients }, { data: services }] = await Promise.all([
    svc.from("profiles").select("id, display_name").in("id", [...new Set(rows.map((r) => r.client_id as string))]),
    svc.from("services").select("id, name").in("id", [...new Set(rows.map((r) => r.service_id as string))]),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, (c.display_name as string) ?? "—"]));
  const serviceName = new Map((services ?? []).map((s) => [s.id as string, s.name as string]));

  return {
    available: true,
    requests: rows.map((r) => ({
      id: r.id as string,
      clientName: clientName.get(r.client_id as string) ?? "—",
      serviceName: serviceName.get(r.service_id as string) ?? "—",
      expiresAt: r.expires_at as string,
    })),
  };
}

// ── The handshake ───────────────────────────────────────────────────────────

export type CreateResult =
  | { ok: true; requestId: string; expiresAt: string }
  | { ok: false; reason: "unavailable" | "no_service" | "no_fit" | "already_pending" | "error" };

// A client requests a specific service from an available practitioner. Guards:
// practitioner genuinely present (fresh heartbeat), service theirs + active +
// fits the gap now, and no live request already open for this pair.
export async function createImmediateRequest(practitionerId: string, serviceId: string): Promise<CreateResult> {
  const user = await gate("client");
  const svc = createServiceRoleClient();

  const { data: available } = await svc.rpc("is_practitioner_available_now", { target: practitionerId });
  if (!available) return { ok: false, reason: "unavailable" };

  const { data: service } = await svc.from("services").select("duration_minutes, practitioner_id, is_active").eq("id", serviceId).single();
  if (!service || service.practitioner_id !== practitionerId || !service.is_active) return { ok: false, reason: "no_service" };

  const fit = await computeImmediateFit(practitionerId, service.duration_minutes as number);
  if (!fit.fits) return { ok: false, reason: "no_fit" };

  // Clear an expired pending for this pair first (else the one-live index blocks).
  await svc.from("immediate_requests").update({ status: "lapsed" }).eq("client_id", user.id).eq("practitioner_id", practitionerId).eq("status", "pending").lt("expires_at", nowIso());

  const expiresAt = new Date(Date.now() + IMMEDIATE_CONFIG.REQUEST_TTL_MS).toISOString();
  const { data: inserted, error } = await svc
    .from("immediate_requests")
    .insert({ client_id: user.id, practitioner_id: practitionerId, service_id: serviceId, expires_at: expiresAt })
    .select("id")
    .single();
  if (error) return { ok: false, reason: error.code === "23505" ? "already_pending" : "error" };
  return { ok: true, requestId: inserted.id as string, expiresAt };
}

export type ConfirmResult = { ok: true; needsPayment: boolean } | { ok: false; reason: "not_pending" | "lapsed" | "no_fit" };

// The practitioner confirms — proving genuine presence. The duration-fit is
// RE-CHECKED here for BOTH paths (never in the payment flow that software_
// provider bookings bypass), against the real projected start. Then, guarded on
// still-pending: availability OFF, other pendings superseded, and —
//   commission:        status → confirmed, a payment-window hold is placed; the
//                      client then pays (startImmediatePayment).
//   software_provider: no payment gate, so confirm IS the booking — the off-grid
//                      booking is created immediately, status → booked.
export async function confirmImmediateRequest(requestId: string): Promise<ConfirmResult> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();

  const { data: req } = await svc.from("immediate_requests").select("client_id, practitioner_id, service_id, status, expires_at").eq("id", requestId).single();
  if (!req || req.practitioner_id !== user.id) notFound();
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };
  if (new Date(req.expires_at as string) <= new Date()) {
    await svc.from("immediate_requests").update({ status: "lapsed" }).eq("id", requestId).eq("status", "pending");
    return { ok: false, reason: "lapsed" };
  }

  const { data: service } = await svc.from("services").select("duration_minutes").eq("id", req.service_id as string).single();
  const fit = await computeImmediateFit(user.id, (service?.duration_minutes as number) ?? 0);
  if (!fit.fits) {
    await svc.from("immediate_requests").update({ status: "declined", responded_at: nowIso() }).eq("id", requestId).eq("status", "pending");
    return { ok: false, reason: "no_fit" };
  }

  const { data: pp } = await svc.from("practitioner_profiles").select("billing_model").eq("id", user.id).single();
  const commission = pp?.billing_model === "commission";
  const reqRow = { client_id: req.client_id as string, practitioner_id: req.practitioner_id as string, service_id: req.service_id as string, request_id: requestId };

  if (commission) {
    // Won the race → confirmed (awaiting payment); place the hold.
    const { data: confirmed } = await svc
      .from("immediate_requests")
      .update({ status: "confirmed", responded_at: nowIso(), projected_start_at: fit.projectedStart, projected_end_at: fit.projectedEnd })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id");
    if (!confirmed || confirmed.length === 0) return { ok: false, reason: "not_pending" };
    await svc.from("immediate_holds").insert({
      practitioner_id: user.id,
      request_id: requestId,
      start_utc: fit.projectedStart,
      end_utc: fit.projectedEnd,
      expires_at: new Date(Date.now() + IMMEDIATE_CONFIG.PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
    });
    await afterAccept(svc, user.id, requestId);
    return { ok: true, needsPayment: true };
  }

  // software_provider — book immediately. Claim the request first (guard), THEN
  // create the booking, so a raced request never produces an orphan booking.
  const { data: claimed } = await svc
    .from("immediate_requests")
    .update({ status: "booked", responded_at: nowIso(), projected_start_at: fit.projectedStart, projected_end_at: fit.projectedEnd })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, reason: "not_pending" };
  await createImmediateBooking(svc, reqRow, fit.projectedStart, fit.projectedEnd);
  await afterAccept(svc, user.id, requestId);
  return { ok: true, needsPayment: false };
}

// Shared post-accept: availability off (they're engaged), and every other
// pending request to this practitioner cleanly superseded (collision resolved).
async function afterAccept(svc: ReturnType<typeof createServiceRoleClient>, practitionerId: string, keepRequestId: string) {
  await svc.from("immediate_presence").update({ available_now: false, updated_at: nowIso() }).eq("practitioner_id", practitionerId);
  await svc.from("immediate_requests").update({ status: "superseded", responded_at: nowIso() }).eq("practitioner_id", practitionerId).eq("status", "pending").neq("id", keepRequestId);
}

export async function declineImmediateRequest(requestId: string): Promise<{ ok: boolean }> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("practitioner_id, status").eq("id", requestId).single();
  if (!req || req.practitioner_id !== user.id) notFound();
  await svc.from("immediate_requests").update({ status: "declined", responded_at: nowIso() }).eq("id", requestId).eq("status", "pending");
  return { ok: true };
}

// The client's bounded status poll: returns the current status, lazily resolving
// the two time-based transitions (pending→lapsed, confirmed-but-payment-window-
// elapsed→payment_failed). The caller STOPS polling on any terminal status
// (booked / declined / lapsed / superseded / payment_failed).
export async function getImmediateRequestStatus(requestId: string): Promise<{ status: string }> {
  const user = await gate("client");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("status, client_id, expires_at").eq("id", requestId).single();
  if (!req || req.client_id !== user.id) notFound();
  let status = req.status as string;
  if (status === "pending" && new Date(req.expires_at as string) <= new Date()) {
    await svc.from("immediate_requests").update({ status: "lapsed" }).eq("id", requestId).eq("status", "pending");
    status = "lapsed";
  } else if (status === "confirmed") {
    const { data: hold } = await svc.from("immediate_holds").select("expires_at").eq("request_id", requestId).maybeSingle();
    if (!hold || new Date(hold.expires_at as string) <= new Date()) {
      await releaseAndFree(svc, requestId);
      status = "payment_failed";
    }
  }
  return { status };
}

// The post-payment (and software_provider book-on-confirm) confirmation page
// polls this: the booking is created out-of-band by the webhook/confirm, so the
// page waits for immediate_request_id to point at a real booking. Returns the
// request status alongside so the page can distinguish "still processing" from a
// terminal non-booked outcome (payment_failed / lapsed) without a second call.
export async function getImmediateBooking(
  requestId: string,
): Promise<{ status: string; bookingId: string | null; username: string | null }> {
  const user = await gate("client");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("status, client_id, practitioner_id").eq("id", requestId).single();
  if (!req || req.client_id !== user.id) notFound();
  const [{ data: booking }, { data: pp }] = await Promise.all([
    svc.from("bookings").select("id").eq("immediate_request_id", requestId).maybeSingle(),
    svc.from("practitioner_profiles").select("username").eq("id", req.practitioner_id as string).single(),
  ]);
  return { status: req.status as string, bookingId: (booking?.id as string) ?? null, username: (pp?.username as string) ?? null };
}

export type StartPaymentResult = { ok: true; url: string } | { ok: false; reason: "not_confirmed" | "expired" | "practitioner_not_ready" | "error" };

// Commission path: the client starts payment once the practitioner has confirmed
// (status 'confirmed', hold still live). Reuses the destination-charge checkout
// with immediate_request_id metadata; the webhook creates the off-grid booking.
export async function startImmediatePayment(requestId: string, locale: string): Promise<StartPaymentResult> {
  const user = await gate("client");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("client_id, practitioner_id, service_id, status").eq("id", requestId).single();
  if (!req || req.client_id !== user.id) notFound();
  if (req.status !== "confirmed") return { ok: false, reason: "not_confirmed" };
  const { data: hold } = await svc.from("immediate_holds").select("expires_at").eq("request_id", requestId).maybeSingle();
  if (!hold || new Date(hold.expires_at as string) <= new Date()) return { ok: false, reason: "expired" };

  const accountId = await getConnectedAccountId(req.practitioner_id as string);
  if (!accountId) return { ok: false, reason: "practitioner_not_ready" };
  const { data: service } = await svc.from("services").select("name, price_cents, currency").eq("id", req.service_id as string).single();
  if (!service) return { ok: false, reason: "error" };

  const origin = await siteOrigin();
  const loc = locale === "en" ? "en" : "bg";
  try {
    const { url } = await createImmediateCheckoutSession(
      {
        practitionerId: req.practitioner_id as string,
        clientId: user.id,
        serviceId: req.service_id as string,
        serviceName: service.name as string,
        priceCents: service.price_cents as number,
        currency: service.currency as string,
        immediateRequestId: requestId,
        successPath: `${origin}/${loc}/immediate/${requestId}?payment=done`,
        cancelPath: `${origin}/${loc}/immediate/${requestId}?payment=cancelled`,
      },
      accountId,
    );
    return { ok: true, url };
  } catch (e) {
    console.error("startImmediatePayment: checkout failed", { requestId, error: e });
    return { ok: false, reason: "error" };
  }
}

// The client returned from a cancelled/failed Stripe Checkout — release the hold
// and free the practitioner immediately rather than waiting out the window.
export async function cancelImmediatePayment(requestId: string): Promise<{ ok: boolean }> {
  const user = await gate("client");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("client_id, status").eq("id", requestId).single();
  if (!req || req.client_id !== user.id) notFound();
  if (req.status === "confirmed") await releaseAndFree(svc, requestId);
  return { ok: true };
}

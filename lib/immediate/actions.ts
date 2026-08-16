"use server";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isEnabled } from "@/lib/flags";
import { IMMEDIATE_CONFIG } from "./config";
import { computeImmediateFit } from "./fit";

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

// Turn "available now" on/off. Notification permission is enforced client-side
// before this is called (the server can't see it); enabling stamps a fresh
// heartbeat so the practitioner is immediately live.
export async function setAvailableNow(available: boolean): Promise<{ ok: true }> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();
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
export async function presenceTick(): Promise<{ available: boolean; requests: InboxRequest[] }> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();

  const { data: presence } = await svc.from("immediate_presence").select("available_now").eq("practitioner_id", user.id).maybeSingle();
  if (!presence?.available_now) return { available: false, requests: [] };

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

export type ConfirmResult = { ok: true } | { ok: false; reason: "not_pending" | "lapsed" | "no_fit" };

// The practitioner confirms — proving genuine presence. Re-checks the window and
// the fit against the real projected start (a service that fitted at request
// time may not now), then: confirms, switches availability OFF (they're in a
// session), and cleanly declines every other pending request via 'superseded'.
export async function confirmImmediateRequest(requestId: string): Promise<ConfirmResult> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();

  const { data: req } = await svc.from("immediate_requests").select("practitioner_id, service_id, status, expires_at").eq("id", requestId).single();
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

  // Guarded on still-pending so a racing lapse/decline can't be overwritten.
  const { data: confirmed } = await svc
    .from("immediate_requests")
    .update({ status: "confirmed", responded_at: nowIso(), projected_start_at: fit.projectedStart, projected_end_at: fit.projectedEnd })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (!confirmed || confirmed.length === 0) return { ok: false, reason: "not_pending" };

  await svc.from("immediate_presence").update({ available_now: false, updated_at: nowIso() }).eq("practitioner_id", user.id);
  await svc.from("immediate_requests").update({ status: "superseded", responded_at: nowIso() }).eq("practitioner_id", user.id).eq("status", "pending").neq("id", requestId);
  return { ok: true };
}

export async function declineImmediateRequest(requestId: string): Promise<{ ok: boolean }> {
  const user = await gate("practitioner");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("practitioner_id, status").eq("id", requestId).single();
  if (!req || req.practitioner_id !== user.id) notFound();
  await svc.from("immediate_requests").update({ status: "declined", responded_at: nowIso() }).eq("id", requestId).eq("status", "pending");
  return { ok: true };
}

// The client's bounded status poll: returns the current status, lazily lapsing
// an expired pending. The caller STOPS polling on any terminal status.
export async function getImmediateRequestStatus(requestId: string): Promise<{ status: string }> {
  const user = await gate("client");
  const svc = createServiceRoleClient();
  const { data: req } = await svc.from("immediate_requests").select("status, client_id, expires_at").eq("id", requestId).single();
  if (!req || req.client_id !== user.id) notFound();
  let status = req.status as string;
  if (status === "pending" && new Date(req.expires_at as string) <= new Date()) {
    await svc.from("immediate_requests").update({ status: "lapsed" }).eq("id", requestId).eq("status", "pending");
    status = "lapsed";
  }
  return { status };
}

import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { refundBookingPayment } from "@/lib/payments";

// The expensive, provider-independent logic: no-show resolution and the
// refund trigger. Reads ONLY our own video_* tables and calls ONLY the
// existing lib/payments seam — no LiveKit type appears anywhere in this
// file, which is the whole point. A provider swap leaves this untouched.

type SessionRow = {
  id: string;
  booking_id: string;
  status: string;
  outcome: string | null;
  fallback_used: boolean;
};

// Resolves a CLOSED session's attendance outcome once, then triggers a
// refund per policy. Safe to call repeatedly (the outcome-already-set and
// not-yet-closed guards make it a no-op except on the first post-close
// call), which is what lets the reconcile sweep drive it.
export async function resolveVideoAttendance(videoSessionId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: session } = await supabase
    .from("video_sessions")
    .select("id, booking_id, status, outcome, fallback_used")
    .eq("id", videoSessionId)
    .single<SessionRow>();

  if (!session || session.status !== "closed" || session.outcome) return;

  // The emergency-contact fallback can't be attendance-verified from join
  // events (the session moved to phone), so flag for manual review rather
  // than auto-refunding on absent joins.
  if (session.fallback_used) {
    await supabase.from("video_sessions").update({ outcome: "manual_review" }).eq("id", session.id);
    return;
  }

  const { data: joins } = await supabase
    .from("video_attendance_events")
    .select("participant_role")
    .eq("video_session_id", session.id)
    .eq("event_type", "participant_joined");

  const clientAttended = !!joins?.some((j) => j.participant_role === "client");
  const practitionerAttended = !!joins?.some((j) => j.participant_role === "practitioner");

  const outcome =
    clientAttended && practitionerAttended
      ? "both_attended"
      : !clientAttended && !practitionerAttended
        ? "neither_attended"
        : !practitionerAttended
          ? "practitioner_no_show"
          : "client_no_show";

  await supabase
    .from("video_sessions")
    .update({ client_attended: clientAttended, practitioner_attended: practitionerAttended, outcome })
    .eq("id", session.id);

  // Refund policy (per product decision):
  //   practitioner_no_show -> full refund incl. commission reversal
  //   neither_attended     -> refund the client (they paid and got
  //                           nothing; also covers a platform outage)
  //   client_no_show       -> no refund
  // refundBookingPayment reuses the cancellation refund path, which
  // reverses the Stripe transfer + application fee (a FULL refund incl.
  // commission) and is a structural no-op for software_provider bookings
  // (nothing was paid through us). NEXT SLICE: also set a booking status
  // and send the client a refund notice — this slice only moves the money.
  if (outcome === "practitioner_no_show" || outcome === "neither_attended") {
    const result = await refundBookingPayment(session.booking_id);
    if (!result.refunded && result.reason !== "not_applicable") {
      console.error("resolveVideoAttendance: refund failed", {
        bookingId: session.booking_id,
        reason: result.reason,
      });
    }
  }
}

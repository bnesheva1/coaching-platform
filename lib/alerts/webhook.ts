import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { raiseAlert } from "./index";

// Inline detection window/threshold for a RECENT burst — deliberately short
// (not the daily sweep window in sweep.ts). "Repeated rather than once" so a
// single transient failure never pages anyone.
const WEBHOOK_BURST_WINDOW_MINUTES = 30;
const WEBHOOK_BURST_THRESHOLD = 3;

// Called from a webhook route's failure path. Records the failure and, if this
// source has now failed repeatedly in the recent window, raises a critical
// alert IMMEDIATELY — this is an inline raise point, the failures are happening
// right now, so the critical genuinely reaches Telegram at once. Best-effort:
// never throws back into the webhook handler.
export async function recordWebhookFailure(source: "stripe" | "livekit", reason: string): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from("webhook_failures").insert({ source, reason });

    const cutoff = new Date(Date.now() - WEBHOOK_BURST_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await supabase
      .from("webhook_failures")
      .select("id", { count: "exact", head: true })
      .eq("source", source)
      .gte("created_at", cutoff);

    if ((count ?? 0) >= WEBHOOK_BURST_THRESHOLD) {
      await raiseAlert({
        type: "webhook_failure",
        subject: source,
        message: `${count} ${source} webhook failures in the last ${WEBHOOK_BURST_WINDOW_MINUTES} minutes.`,
        context: { source, count, lastReason: reason },
        immediate: true,
      });
    }
  } catch (error) {
    console.error("recordWebhookFailure failed", { source, error });
  }
}

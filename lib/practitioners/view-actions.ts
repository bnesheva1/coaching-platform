"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, viewCounterLimiter } from "@/lib/rate-limit";

// Bumps a privacy-safe aggregate counter (see increment_view_counter). Fired
// fire-and-forget from the public profile, deduped per session client-side. IP
// rate-limited (transient key, never stored) to bound scripted inflation, and
// guarded server-side so a practitioner viewing their OWN profile is never
// counted (defense-in-depth over the client's own owner check). Records nothing
// identifying — only the increment.
async function record(practitionerId: string, metric: "profile_viewed" | "schedule_opened"): Promise<void> {
  const { success } = await checkRateLimit(viewCounterLimiter, getClientIp(await headers()));
  if (!success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === practitionerId) return;

  await supabase.rpc("increment_view_counter", { p_practitioner_id: practitionerId, p_metric: metric });
}

export async function recordProfileView(practitionerId: string): Promise<void> {
  await record(practitionerId, "profile_viewed");
}

export async function recordScheduleOpen(practitionerId: string): Promise<void> {
  await record(practitionerId, "schedule_opened");
}

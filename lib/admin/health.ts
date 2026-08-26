import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { checkStripeConnection, stripeMode, defaultBillingModel } from "@/lib/payments";
import { checkEmailConnection } from "@/lib/email";
import { checkVideoConnection, liveKitPlan } from "@/lib/video";
import { checkRateLimitConnection } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/flags";
import { SITE_URL } from "@/lib/seo";
import { getStorageUsage, storageHealthItem } from "@/lib/storage/usage";
import { type ConnectionResult, errorMessage } from "@/lib/health/types";

export type HealthStatus = "pass" | "fail" | "degraded";

// A dependency reachability check: what was actually confirmed, plus the
// provider's own error message when it fails.
export type DependencyCheck = { name: string; status: HealthStatus; detail: string; error?: string };

// A configuration value, stated plainly. `level: "warn"` flags a value that has
// bitten before (a redirect that silently swallows all mail, a sandbox sender,
// live Stripe keys) so it reads at a glance, without pretending to be a test.
export type ConfigItem = { name: string; value: string; level: "ok" | "warn"; note?: string };

export type CronState = { status: HealthStatus; detail: string; lastRunAt: string | null; summary: unknown };

export type HealthReport = {
  checkedAt: string;
  dependencies: DependencyCheck[];
  config: ConfigItem[];
  cron: CronState;
};

// Each provider check gets a hard ceiling so one hung dependency can't hang the
// whole page — a timeout is itself a fail worth showing.
const TIMEOUT_MS = 6000;
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
  ]);
}

// Runs a seam's ConnectionResult check and maps it to a DependencyCheck.
// `failStatus` is "degraded" for a fail-open dependency (Upstash), "fail" for
// the rest.
async function toCheck(
  name: string,
  run: () => Promise<ConnectionResult>,
  failStatus: HealthStatus = "fail",
): Promise<DependencyCheck> {
  try {
    const r = await withTimeout(run(), name);
    return {
      name,
      status: r.ok ? "pass" : failStatus,
      detail: r.detail ?? (r.ok ? "OK" : "Failed"),
      error: r.error,
    };
  } catch (e) {
    return { name, status: failStatus, detail: `${name} check failed`, error: errorMessage(e) };
  }
}

// Supabase isn't behind a provider seam (it's used raw across the app), so its
// check lives here: a HEAD count on the tiny feature_flags table proves the
// database is reachable AND the service-role key is valid (the query runs as
// service role and would be rejected otherwise).
async function checkSupabase(): Promise<DependencyCheck> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await withTimeout(
      Promise.resolve(supabase.from("feature_flags").select("key", { head: true, count: "exact" })),
      "Supabase",
    );
    if (error) return { name: "Supabase", status: "fail", detail: "Query rejected", error: error.message };
    return { name: "Supabase", status: "pass", detail: "Database reachable; service-role key valid" };
  } catch (e) {
    return { name: "Supabase", status: "fail", detail: "Database unreachable", error: errorMessage(e) };
  }
}

// The cron heartbeat. The daily cron (send-reminders) writes a cron_runs row at
// the end of every invocation; a stopped cron is otherwise invisible, and
// outcome resolution / reminders / room-close / the alert sweep all ride on it.
// Older than ~25h (the daily cadence plus slack) => it likely stopped => fail.
async function checkCron(): Promise<CronState> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await withTimeout(
      Promise.resolve(supabase.from("cron_runs").select("ran_at, summary").order("ran_at", { ascending: false }).limit(1).maybeSingle()),
      "cron",
    );
    if (error) {
      // Most likely the migration hasn't been applied yet.
      return { status: "degraded", detail: "Could not read cron history (is the cron_runs table migrated?)", lastRunAt: null, summary: null };
    }
    if (!data) {
      return { status: "degraded", detail: "No cron run recorded yet.", lastRunAt: null, summary: null };
    }
    const ranAt = data.ran_at as string;
    const hours = (Date.now() - new Date(ranAt).getTime()) / 3_600_000;
    const ago = hours < 1 ? `${Math.round(hours * 60)} min ago` : `${hours.toFixed(1)}h ago`;
    return hours > 25
      ? { status: "fail", detail: `Last ran ${ago} — the daily cron appears to have stopped.`, lastRunAt: ranAt, summary: data.summary }
      : { status: "pass", detail: `Last ran ${ago}.`, lastRunAt: ranAt, summary: data.summary };
  } catch (e) {
    return { status: "degraded", detail: "Could not read cron history.", lastRunAt: null, summary: errorMessage(e) };
  }
}

function gatherConfig(requireEmailConfirmation: boolean): ConfigItem[] {
  const devOverride = process.env.DEV_EMAIL_OVERRIDE?.trim();
  const from = process.env.RESEND_FROM_EMAIL ?? "(unset)";
  const mode = stripeMode();

  return [
    devOverride
      ? {
          name: "DEV_EMAIL_OVERRIDE",
          value: `ALL mail → ${devOverride}`,
          level: "warn",
          note: "Every outgoing email is silently redirected to this address. Unset once a real sending domain is verified.",
        }
      : { name: "DEV_EMAIL_OVERRIDE", value: "unset", level: "ok", note: "Mail goes to real recipients." },
    {
      name: "RESEND_FROM_EMAIL",
      value: from,
      level: from === "onboarding@resend.dev" ? "warn" : "ok",
      note: from === "onboarding@resend.dev" ? "Resend's sandbox sender — can only deliver to the account owner; every other recipient 422s." : undefined,
    },
    { name: "SITE_URL", value: SITE_URL, level: "ok", note: "Used for canonical URLs, email links and redirects — a wrong value poisons all of them." },
    {
      name: "Stripe mode",
      value: mode,
      level: mode === "live" ? "warn" : "ok",
      note: mode === "live" ? "LIVE — real charges." : mode === "unknown" ? "STRIPE_SECRET_KEY missing or has an unrecognised prefix." : undefined,
    },
    {
      // PRESENCE only — a wrong webhook secret can't be detected without a real
      // signed webhook (unlike the API key, which the dependency check above
      // validates live). A bad one surfaces as repeated webhook_failure alerts,
      // not here. Stated so the distinction is honest, not implied.
      name: "STRIPE_WEBHOOK_SECRET",
      value: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "unset",
      level: process.env.STRIPE_WEBHOOK_SECRET ? "ok" : "warn",
      note: "Presence only — correctness can't be checked here; a wrong secret shows up as repeated webhook_failure alerts.",
    },
    {
      // Presence only. If it's wrong, Vercel's scheduler gets a 401 and the cron
      // silently stops — which then surfaces in the Cron section below as a
      // stale last-run, not here.
      name: "CRON_SECRET",
      value: process.env.CRON_SECRET ? "set" : "unset",
      level: process.env.CRON_SECRET ? "ok" : "warn",
      note: "Presence only — if wrong, the daily cron 401s and stops (see Cron below).",
    },
    { name: "REQUIRE_EMAIL_CONFIRMATION", value: String(requireEmailConfirmation), level: "ok" },
    { name: "LIVEKIT_PLAN", value: liveKitPlan(), level: "ok" },
    { name: "DEFAULT_BILLING_MODEL", value: defaultBillingModel(), level: "ok" },
  ];
}

// THE health report. Runs every dependency check live, in parallel, on each
// call — never cached (a stale health page is worse than none). The caller (the
// admin health page) is force-dynamic so this runs on every load.
export async function runHealthReport(): Promise<HealthReport> {
  const requireEmailConfirmation = await isEnabled("requireEmailConfirmation");

  const [supabase, stripe, resend, livekit, upstash, cron, storage] = await Promise.all([
    checkSupabase(),
    toCheck("Stripe", checkStripeConnection),
    toCheck("Resend", checkEmailConnection),
    toCheck("LiveKit", checkVideoConnection),
    toCheck("Upstash", checkRateLimitConnection, "degraded"),
    checkCron(),
    getStorageUsage(),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    dependencies: [supabase, stripe, resend, livekit, upstash],
    // Storage usage sits with the config values (it's a stated metric, not a
    // reachability check) — flagged 'warn' once it crosses the threshold.
    config: [...gatherConfig(requireEmailConfirmation), storageHealthItem(storage)],
    cron,
  };
}

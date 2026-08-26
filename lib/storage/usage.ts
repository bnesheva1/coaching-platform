import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { raiseAlert } from "@/lib/alerts";
import type { ConfigItem } from "@/lib/admin/health";

// "Running low on storage" guard. Supabase's free tier is 1GB total,
// SHARED across every bucket — session documents now compete with
// avatars/banners/service images for it. This measures usage (via the
// get_storage_usage RPC) so the daily sweep can warn before it fills and
// the admin health page can show the breakdown. Alert-only: nothing here
// blocks uploads.

const DOCUMENTS_BUCKET = "session-documents";
const GIB = 1024 * 1024 * 1024;

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// A fraction in (0,1]; anything out of range falls back to the default.
function fractionEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

// Deploy-scope tuning, read once (same pattern as the other env knobs).
// The default limit is the free tier; a paid deployment raises it.
export const STORAGE_LIMIT_BYTES = positiveIntEnv(process.env.STORAGE_TOTAL_BYTES, GIB);
export const STORAGE_WARN_THRESHOLD = fractionEnv(process.env.STORAGE_WARN_THRESHOLD, 0.8);

export type StorageUsage = {
  limitBytes: number;
  totalBytes: number;
  fraction: number; // totalBytes / limitBytes
  warnThreshold: number;
  over: boolean; // fraction >= warnThreshold
  documentsBytes: number;
  documentsCount: number;
  byBucket: { bucketId: string; bytes: number; count: number }[];
};

export function formatGB(bytes: number): string {
  return `${(bytes / GIB).toFixed(2)} GB`;
}

// Returns null when the RPC is missing/errors (migration not applied yet),
// so callers can degrade gracefully rather than throw.
export async function getStorageUsage(): Promise<StorageUsage | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_storage_usage");
  if (error) {
    console.error("getStorageUsage: RPC failed", { error });
    return null;
  }

  const rows = (data ?? []) as { bucket_id: string; total_bytes: number; object_count: number }[];
  const byBucket = rows.map((r) => ({ bucketId: r.bucket_id, bytes: Number(r.total_bytes), count: Number(r.object_count) }));
  const totalBytes = byBucket.reduce((sum, b) => sum + b.bytes, 0);
  const docs = byBucket.find((b) => b.bucketId === DOCUMENTS_BUCKET);
  const fraction = STORAGE_LIMIT_BYTES > 0 ? totalBytes / STORAGE_LIMIT_BYTES : 0;

  return {
    limitBytes: STORAGE_LIMIT_BYTES,
    totalBytes,
    fraction,
    warnThreshold: STORAGE_WARN_THRESHOLD,
    over: fraction >= STORAGE_WARN_THRESHOLD,
    documentsBytes: docs?.bytes ?? 0,
    documentsCount: docs?.count ?? 0,
    byBucket,
  };
}

// Daily-sweep pass: raise a warning alert when total storage crosses the
// threshold. Best-effort (raiseAlert never throws). Warning severity =>
// dashboard + daily digest, not an immediate Telegram page — a filling
// disk is urgent-ish, not a 3am wake-up. The alert carries how much of the
// usage is documents, so the cause is visible at a glance.
export async function sweepStorageUsage(): Promise<{ storagePct: number | null }> {
  const usage = await getStorageUsage();
  if (!usage) return { storagePct: null };

  const pct = Math.round(usage.fraction * 100);
  if (usage.over) {
    await raiseAlert({
      type: "storage_low",
      // Stable subject so it's one tracked condition, not a new row per run.
      subject: "supabase-storage",
      message: `Supabase storage at ${pct}% of ${formatGB(usage.limitBytes)} (documents: ${formatGB(usage.documentsBytes)})`,
      context: {
        // Coarse band so day-to-day jitter doesn't churn the fingerprint;
        // the exact figures live on the health page.
        usageBand: `${Math.floor(pct / 5) * 5}%+`,
        documentsBytes: usage.documentsBytes,
        documentsCount: usage.documentsCount,
      },
    });
  }
  return { storagePct: pct };
}

// The admin health page row. A metric, not a reachability check, so it maps
// to a ConfigItem (name/value/note/level) — flagged 'warn' once over the
// threshold, same visual language as the other flagged config values.
export function storageHealthItem(usage: StorageUsage | null): ConfigItem {
  if (!usage) {
    return {
      name: "Storage",
      value: "unknown",
      level: "warn",
      note: "Could not read storage usage — is the get_storage_usage RPC migrated?",
    };
  }
  const pct = Math.round(usage.fraction * 100);
  return {
    name: "Storage",
    value: `${formatGB(usage.totalBytes)} / ${formatGB(usage.limitBytes)} (${pct}%)`,
    level: usage.over ? "warn" : "ok",
    note: `Documents: ${formatGB(usage.documentsBytes)} across ${usage.documentsCount} file(s). Warns at ${Math.round(usage.warnThreshold * 100)}%.`,
  };
}

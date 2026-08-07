import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// Rename rate limits, enforced server-side. The limits are deliberately
// asymmetric: a practitioner's name is public, indexed, and attached to
// reviews, so it's tighter than a client's; a username underpins links and
// bookmarks, so it's tighter still.
//
// The rename_events audit table is the single source of truth — it's both
// the change history and the counter, so "how many changes remain" can
// never drift from what enforcement actually allows. This is the app's
// server-side rate-limit stance (enforce in the action, not just the UI),
// applied over a per-user long window rather than the short IP/user
// windows lib/rate-limit.ts handles.
export type RenameKind = "client_display_name" | "practitioner_display_name" | "username";

const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIG: Record<RenameKind, { field: "display_name" | "username"; limit: number; windowDays: number }> = {
  client_display_name: { field: "display_name", limit: 3, windowDays: 30 },
  practitioner_display_name: { field: "display_name", limit: 2, windowDays: 90 },
  username: { field: "username", limit: 1, windowDays: 90 },
};

export type RenameUsage = {
  limit: number;
  windowDays: number;
  used: number;
  remaining: number;
  // ISO timestamp of when the next change becomes possible — only set when
  // remaining is 0 (a sliding window frees a slot when the oldest change in
  // the window ages out).
  nextAllowedAt: string | null;
};

export async function getRenameUsage(userId: string, kind: RenameKind): Promise<RenameUsage> {
  const { field, limit, windowDays } = CONFIG[kind];
  const admin = createServiceRoleClient();
  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();

  const { data } = await admin
    .from("rename_events")
    .select("created_at")
    .eq("user_id", userId)
    .eq("field", field)
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const events = data ?? [];
  const used = events.length;
  const remaining = Math.max(0, limit - used);
  const nextAllowedAt =
    remaining === 0 && events.length > 0
      ? new Date(new Date(events[0].created_at).getTime() + windowDays * DAY_MS).toISOString()
      : null;

  return { limit, windowDays, used, remaining, nextAllowedAt };
}

const INTL_LOCALES: Record<string, string> = { bg: "bg-BG", en: "en-US" };

// The "you can change it again on <date>" date, formatted in the caller's
// locale — used in the at-the-limit message so it's a concrete date, not a
// silent failure or a generic error.
export function formatRenameDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "en-US", { dateStyle: "long" }).format(new Date(iso));
}

export async function recordRename(
  userId: string,
  field: "display_name" | "username",
  oldValue: string | null,
  newValue: string,
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("rename_events")
    .insert({ user_id: userId, field, old_value: oldValue, new_value: newValue });
  if (error) console.error("recordRename failed", { userId, field, error });
}

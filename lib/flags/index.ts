import "server-only";
import { unstable_cache, updateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { FLAGS, type FlagKey } from "./registry";

export { FLAGS } from "./registry";
export type { FlagKey, FlagScope, FlagDef } from "./registry";

// The cache tag for the runtime-override table. The admin toggle action (next
// slice) calls invalidateFlags() after writing, so a change is visible on the
// very next request instead of waiting out the revalidate window.
const FLAGS_TAG = "feature-flags";

// The whole (tiny) override table, cached across requests and tagged. A flag
// check therefore hits the DB only on a cache miss or right after a toggle,
// never on every request. Fails SAFE — a read error resolves to no overrides
// (env/default) rather than throwing, so a flags hiccup can't take the app
// down or flip every gate at once.
const getOverrides = unstable_cache(
  async (): Promise<Record<string, boolean>> => {
    const { data, error } = await createServiceRoleClient().from("feature_flags").select("key, enabled");
    if (error) {
      console.error("feature flags: overrides read failed", error);
      return {};
    }
    return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.enabled as boolean]));
  },
  ["feature-flags-overrides"],
  { tags: [FLAGS_TAG], revalidate: 60 },
);

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  return v === "true" ? true : v === "false" ? false : undefined;
}

// THE consumer API — server-only (this module reads via the service role, so
// client components receive resolved booleans as props instead). Callers
// never know which layer answered.
//
// Resolution order:
//   runtime: DB override (admin) -> env baseline -> code default
//   deploy:                          env baseline -> code default  (no DB read)
export async function isEnabled(flag: FlagKey): Promise<boolean> {
  const def = FLAGS[flag];
  if (def.scope === "runtime") {
    const overrides = await getOverrides();
    if (flag in overrides) return overrides[flag];
  }
  return envBool(def.envVar) ?? def.default;
}

// Immediately expire the cached overrides so the admin sees their toggle take
// effect right away (read-your-own-writes), not after the revalidate window.
// updateTag is Server-Actions-only — which is exactly where the admin toggle
// (next slice) runs.
export function invalidateFlags() {
  updateTag(FLAGS_TAG);
}

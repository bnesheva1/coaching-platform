// The shape every dependency check returns to the health report. `ok` maps to
// pass/fail (or degraded, for a fail-open dependency like Upstash); `detail`
// states what was actually confirmed ("API key valid — test mode"), not just
// that something answered; `error` carries the provider's own message on
// failure so it's shown rather than inferred.
export type ConnectionResult = { ok: boolean; detail?: string; error?: string };

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

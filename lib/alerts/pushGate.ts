// Whether alert PUSH adapters (Telegram, etc.) should actually fire. Push only
// in real production; local dev, test runs, and Vercel preview deploys record
// the alert row but stay silent — so verification scripts never spam the live
// alert channel. The alert ROW is always recorded regardless; this gates only
// the outbound push.
export function pushAdaptersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Vercel sets VERCEL_ENV = production | preview | development, but NODE_ENV is
  // "production" for BOTH prod and preview builds — so prefer VERCEL_ENV when
  // present (only true production pushes), and fall back to NODE_ENV locally.
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

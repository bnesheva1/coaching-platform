// Alert push gate — unit verification of the production-only push decision.
// Confirms a prod-mode raise WOULD push (Telegram/adapters) and dev/test/preview
// WOULD NOT, so this behaviour is tested rather than assumed. The gate is the
// single choke point pushToAdapters() and the admin tripwire both call.
// Run: node scripts/verify-alert-push-gate.ts
import { pushAdaptersEnabled } from "../lib/alerts/pushGate.ts";

let failures = 0;
const check = (label: string, cond: boolean) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
};

// Production → push fires.
check("VERCEL_ENV=production → push", pushAdaptersEnabled({ VERCEL_ENV: "production" }) === true);
check("no VERCEL_ENV + NODE_ENV=production → push", pushAdaptersEnabled({ NODE_ENV: "production" }) === true);

// Everything else → recorded silently, no push.
check("VERCEL_ENV=preview → no push", pushAdaptersEnabled({ VERCEL_ENV: "preview" }) === false);
check("VERCEL_ENV=development → no push", pushAdaptersEnabled({ VERCEL_ENV: "development" }) === false);
check("VERCEL_ENV=preview even with NODE_ENV=production → no push", pushAdaptersEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" }) === false);
check("no VERCEL_ENV + NODE_ENV=development → no push", pushAdaptersEnabled({ NODE_ENV: "development" }) === false);
check("no VERCEL_ENV + NODE_ENV=test → no push", pushAdaptersEnabled({ NODE_ENV: "test" }) === false);
check("empty env → no push", pushAdaptersEnabled({}) === false);

console.log(`\n=== ${failures === 0 ? "ALL PASSED" : failures + " FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);

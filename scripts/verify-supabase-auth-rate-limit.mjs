// Empirically checks whether Supabase Auth's own dashboard-configured
// sign-in rate limit is actually enforced — there's a known upstream
// GitHub issue (supabase/auth#2333, supabase/supabase#41947) where
// configured limits sometimes silently don't apply. Don't trust the
// dashboard setting; verify it against the live project.
//
// Uses a nonexistent email on purpose: Supabase's sign-in rate limiting
// is IP-based and applies before/regardless of whether the account
// exists (to avoid leaking account existence via timing), so this
// exercises the same bucket a real credential-stuffing attempt would hit
// without creating or touching any real test account.
//
// Run: node --env-file=.env.local scripts/verify-supabase-auth-rate-limit.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const anon = createClient(url, key);

const ATTEMPTS = 30;
const nonexistentEmail = `verify-ratelimit-${Date.now()}@example.com`;

let firstRateLimitedAt = null;

for (let i = 1; i <= ATTEMPTS; i++) {
  const { error } = await anon.auth.signInWithPassword({
    email: nonexistentEmail,
    password: "deliberately-wrong-password",
  });
  const status = error?.status ?? "?";
  const code = error?.code ?? error?.message ?? "?";
  const isRateLimited = status === 429 || code?.toString().includes("rate_limit");
  if (isRateLimited && firstRateLimitedAt === null) firstRateLimitedAt = i;
  console.log(`attempt ${i}/${ATTEMPTS}: status=${status} code=${code}`);
}

console.log("\n=== RESULT ===");
if (firstRateLimitedAt !== null) {
  console.log(
    `Supabase's own sign-in rate limit WAS enforced — kicked in at attempt ${firstRateLimitedAt}/${ATTEMPTS}.`,
  );
  console.log(
    "Compare this to whatever you configured in Authentication > Rate Limits — if it kicked in much later than expected, the dashboard setting may not match reality.",
  );
} else {
  console.log(
    `Supabase's own sign-in rate limit did NOT trigger across ${ATTEMPTS} attempts.`,
  );
  console.log(
    "This matches the known upstream issue where configured limits sometimes don't enforce. " +
      "Treat this as best-effort only — the in-app Upstash-based login limiter " +
      "(lib/rate-limit.ts, verified separately) is the layer actually doing the work.",
  );
}

// Fires 21 sequential GET requests at /auth/callback against a running
// dev server and confirms the 21st (over the configured 20/10min limit)
// gets a real 429 — the rate-limit check runs before the route handler,
// so no `code` query param is needed; it 429s before ever reaching
// exchangeCodeForSession.
//
// Prerequisite: `npm run dev` running in another terminal, and
// UPSTASH_REDIS_REST_URL/TOKEN set in .env.local.
//
// Run: node --env-file=.env.local scripts/verify-rate-limit-callback.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LIMIT = 20;

let failures = 0;

for (let i = 1; i <= LIMIT + 1; i++) {
  const res = await fetch(`${BASE_URL}/auth/callback`, { redirect: "manual" });
  const expected429 = i > LIMIT;
  const got429 = res.status === 429;
  const ok = got429 === expected429;
  if (!ok) failures++;
  const retryAfter = res.headers.get("retry-after");
  console.log(
    `request ${i}/${LIMIT + 1}: status=${res.status} ${got429 ? `retry-after=${retryAfter}` : ""} ${ok ? "PASS" : "FAIL"}`,
  );
}

console.log(`\n=== RESULT: ${failures === 0 ? "PASS" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

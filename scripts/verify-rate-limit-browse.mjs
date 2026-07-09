// Fires 31 sequential GET requests at /en/browse against a running dev
// server and confirms the 31st (over the configured 30/min limit) gets a
// real 429 with a Retry-After header, and the first 30 succeed.
//
// Prerequisite: `npm run dev` running in another terminal, and
// UPSTASH_REDIS_REST_URL/TOKEN set in .env.local.
//
// Run: node --env-file=.env.local scripts/verify-rate-limit-browse.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LIMIT = 30;

let failures = 0;

for (let i = 1; i <= LIMIT + 1; i++) {
  const res = await fetch(`${BASE_URL}/en/browse?q=verify-rate-limit-test`);
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

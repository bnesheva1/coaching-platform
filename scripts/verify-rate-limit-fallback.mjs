// Proves the in-memory fallback in lib/rate-limit.ts actually kicks in
// and enforces a real limit when Upstash errors — not just that it
// compiles. Imports checkRateLimit directly and hands it a RateLimiter
// whose .upstash.limit() is guaranteed to throw, simulating an Upstash
// outage/quota-exhaustion, then confirms:
//   1. The first `limit` calls succeed (fallback allows them)
//   2. Call `limit + 1` is REJECTED (fallback enforces the cap, doesn't
//      just fail open)
//
// Run: node scripts/verify-rate-limit-fallback.mjs (no real Upstash
// credentials needed — the whole point is Upstash is never actually
// reached in this test).

process.env.UPSTASH_REDIS_REST_URL ??= "https://unused.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN ??= "unused";

const { checkRateLimit } = await import("../lib/rate-limit.ts");

const brokenLimiter = {
  upstash: { limit: async () => { throw new Error("simulated Upstash outage"); } },
  limit: 5,
  windowMs: 10 * 60 * 1000,
  prefix: "rl:verify-fallback-test",
};

let failures = 0;
const key = `fallback-test-${Date.now()}`;

for (let i = 1; i <= brokenLimiter.limit + 1; i++) {
  const result = await checkRateLimit(brokenLimiter, key);
  const expected = i <= brokenLimiter.limit;
  const ok = result.success === expected;
  if (!ok) failures++;
  console.log(`request ${i}/${brokenLimiter.limit + 1}: success=${result.success} (expected ${expected}) ${ok ? "PASS" : "FAIL"}`);
}

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — fallback enforces the limit even when Upstash is fully down, does NOT fail fully open" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

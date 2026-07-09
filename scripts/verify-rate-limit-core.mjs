// Exercises the real Ratelimit.slidingWindow config directly against live
// Upstash — proves the window math/off-by-ones and the Upstash
// integration itself work, independent of any Next.js plumbing.
//
// Run: node --env-file=.env.local scripts/verify-rate-limit-core.mjs

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.\n" +
      "Create a free database at https://console.upstash.com, copy the REST URL + token\n" +
      "into .env.local, then re-run this script.",
  );
  process.exit(1);
}

const redis = Redis.fromEnv();
const limit = 5;
const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(limit, "10 m"),
  prefix: `rl:verify-core:${Date.now()}`, // unique per run, avoids collisions with prior runs
});

const key = "verify-script-test-key";
let failures = 0;

for (let i = 1; i <= limit + 1; i++) {
  const result = await limiter.limit(key);
  const expected = i <= limit;
  const ok = result.success === expected;
  if (!ok) failures++;
  console.log(
    `request ${i}/${limit + 1}: success=${result.success} (expected ${expected}) ${ok ? "PASS" : "FAIL"}`,
  );
}

console.log(`\n=== RESULT: ${failures === 0 ? "PASS — sliding window enforces the configured limit correctly" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

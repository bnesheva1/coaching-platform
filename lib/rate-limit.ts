import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the
// environment automatically.
const redis = Redis.fromEnv();

export type RateLimiter = {
  upstash: Ratelimit;
  limit: number;
  windowMs: number;
  prefix: string;
};

// Distinct `prefix` per limiter so the same IP never shares a bucket
// across endpoints (e.g. hammering search shouldn't burn down your login
// budget). Numbers are deliberately hardcoded here rather than pulled
// into env vars — four static values don't warrant a config layer at
// this stage. See the rate-limiting plan for the reasoning behind each.
//
// limit/windowMs are duplicated here (Ratelimit.slidingWindow only takes
// a string like "10 m") so checkRateLimit's in-memory fallback below can
// enforce the *same* numbers without needing to parse them back out of
// the Upstash config.
function createLimiter(prefix: string, limit: number, window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`, windowMs: number): RateLimiter {
  return {
    upstash: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix,
      analytics: true,
    }),
    limit,
    windowMs,
    prefix,
  };
}

export const signupLimiter = createLimiter("rl:signup", 5, "10 m", 10 * 60 * 1000);
export const loginLimiter = createLimiter("rl:login", 10, "5 m", 5 * 60 * 1000);
export const searchLimiter = createLimiter("rl:search", 30, "1 m", 60 * 1000);
export const authCallbackLimiter = createLimiter("rl:callback", 20, "10 m", 10 * 60 * 1000);
// Keyed by the authenticated user's own id (not IP) — booking already
// requires auth, so the user id is a more precise identifier than IP for
// bounding one account spam-booking a practitioner's calendar. Generous
// enough for any real client's normal use.
export const bookingLimiter = createLimiter("rl:booking", 10, "10 m", 10 * 60 * 1000);

export type RateLimitResult = {
  success: boolean;
  retryAfterSeconds: number;
};

// Last-resort backstop for when Upstash itself is unreachable — including
// exhausting the free-tier command quota, which Upstash's own docs
// confirm causes it to start rejecting requests, indistinguishable here
// from an outage. Without this, a flood large enough to burn through the
// monthly quota would make the *rate limiter itself* fail open at
// exactly the moment it's needed, which defeats the point.
//
// This is a fixed-window counter in a module-level Map, so it only
// persists across warm invocations of the SAME serverless function
// instance — Vercel can run several instances concurrently, so the true
// global limit while in fallback mode is looser than the configured
// number (up to roughly limit × concurrent-instance-count). That's a
// real, known weakness, not a hidden one: it's meaningfully better than
// zero protection (the old fail-open behavior), but weaker than the
// primary Upstash-backed check. Good enough as a backstop for a small
// platform; not a substitute for keeping Upstash itself healthy.
const fallbackBuckets = new Map<string, { count: number; windowStart: number }>();
let fallbackCheckCount = 0;

function pruneFallbackBuckets(now: number) {
  for (const [key, bucket] of fallbackBuckets) {
    if (now - bucket.windowStart > 60 * 60 * 1000) fallbackBuckets.delete(key);
  }
}

function checkFallback(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic cleanup so a long-lived warm instance doesn't
  // accumulate unbounded distinct-IP entries — cheap, no timers/cron
  // needed for a proportionate backstop like this.
  fallbackCheckCount++;
  if (fallbackCheckCount % 1000 === 0) pruneFallbackBuckets(now);

  const bucket = fallbackBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    fallbackBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

// Every caller goes through this one function so the fail-open ->
// fallback-protected behavior can't drift or get re-implemented
// differently per endpoint.
export async function checkRateLimit(
  limiter: RateLimiter,
  identifier: string,
): Promise<RateLimitResult> {
  try {
    const result = await limiter.upstash.limit(identifier);
    return {
      success: result.success,
      retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch (error) {
    console.error("[rate-limit] Upstash unreachable, using in-memory fallback", {
      prefix: limiter.prefix,
      identifier,
      error,
    });
    const allowed = checkFallback(`${limiter.prefix}:${identifier}`, limiter.limit, limiter.windowMs);
    if (!allowed) {
      console.error("[rate-limit] in-memory fallback also rejected this request", {
        prefix: limiter.prefix,
        identifier,
      });
    }
    return { success: allowed, retryAfterSeconds: allowed ? 0 : Math.ceil(limiter.windowMs / 1000) };
  }
}

// Shared by proxy.ts (`request.headers`) and the Server Actions
// (`await headers()`) — both hand this a plain Headers object, so there's
// one IP-parsing implementation instead of two. Vercel's edge network
// populates x-forwarded-for with the real client IP first, followed by
// its own proxy hops; falls back to "unknown" so local dev (no XFF
// header) doesn't throw — everyone just shares one bucket locally.
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) return "unknown";
  return forwardedFor.split(",")[0].trim() || "unknown";
}

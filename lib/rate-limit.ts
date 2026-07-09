import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the
// environment automatically.
const redis = Redis.fromEnv();

// Distinct `prefix` per limiter so the same IP never shares a bucket
// across endpoints (e.g. hammering search shouldn't burn down your login
// budget). Numbers are deliberately hardcoded here rather than pulled
// into env vars — four static values don't warrant a config layer at
// this stage. See the rate-limiting plan for the reasoning behind each.
export const signupLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "10 m"),
  prefix: "rl:signup",
  analytics: true,
});

export const loginLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "5 m"),
  prefix: "rl:login",
  analytics: true,
});

export const searchLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "rl:search",
  analytics: true,
});

export const authCallbackLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "10 m"),
  prefix: "rl:callback",
  analytics: true,
});

export type RateLimitResult = {
  success: boolean;
  retryAfterSeconds: number;
};

// The single fail-open implementation: if Upstash itself errors (network
// blip, outage), log it and let the request through rather than taking
// down signup/login/search for everyone over a rate-limiter dependency
// failure. Every caller goes through this one function so that choice
// can't drift or get re-implemented differently per endpoint.
export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<RateLimitResult> {
  try {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch (error) {
    console.error("[rate-limit] check failed, failing open", { identifier, error });
    return { success: true, retryAfterSeconds: 0 };
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

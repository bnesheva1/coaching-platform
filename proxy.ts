import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";
import { stripLocale } from "@/lib/locale-path";
import {
  checkRateLimit,
  getClientIp,
  searchLimiter,
  authCallbackLimiter,
} from "@/lib/rate-limit";

// Next.js 16 renamed the "middleware" file convention to "proxy" — this
// runs on every matched request, before rendering. It composes two
// concerns in one pass: next-intl's locale resolution/redirect runs
// first, then our own session refresh + protected-route redirect layers
// on top of whatever response that produced.
const handleI18nRouting = createIntlMiddleware(routing);

// A rejected request here never pays for locale resolution or a Supabase
// session round-trip. Only GET endpoints are checked here — signup/login
// are Server Actions checked inside the action itself (see
// app/[locale]/signup/actions.ts), since a Server Component like
// browse/page.tsx has no way to emit a 429 on its own, but a middleware
// 429 wouldn't match the response shape a Server Action's caller expects.
function rateLimitedGetEndpoint(request: NextRequest) {
  if (request.method !== "GET") return null;
  // Both auth link-verification endpoints share the same limiter — /auth/confirm
  // verifies an emailed recovery token_hash, so it warrants the same guard
  // against token enumeration that /auth/callback already has.
  if (
    request.nextUrl.pathname === "/auth/callback" ||
    request.nextUrl.pathname === "/auth/confirm"
  )
    return authCallbackLimiter;
  if (stripLocale(request.nextUrl.pathname) === "/browse") return searchLimiter;
  return null;
}

export async function proxy(request: NextRequest) {
  const limiter = rateLimitedGetEndpoint(request);
  if (limiter) {
    const ip = getClientIp(request.headers);
    const { success, retryAfterSeconds } = await checkRateLimit(limiter, ip);
    if (!success) {
      return new NextResponse("Too many requests. Please try again shortly.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain",
          "Retry-After": String(retryAfterSeconds),
        },
      });
    }
  }

  // The /auth/* route handlers live outside app/[locale] — they're route
  // handlers, not pages, and were never meant to be locale-prefixed. Without
  // this, the routing config below (localePrefix: "always") redirects e.g.
  // /auth/callback to /bg/auth/callback or /en/auth/callback, neither of which
  // is a real route, breaking every magic-link/OAuth/recovery redirect into
  // this app. /auth/confirm (dashboard-triggered recovery token_hash links)
  // needs the same bypass as /auth/callback (PKCE). This predates the
  // rate-limiting work above — found while testing it.
  if (
    request.nextUrl.pathname === "/auth/callback" ||
    request.nextUrl.pathname === "/auth/confirm"
  ) {
    return updateSession(request, NextResponse.next());
  }

  const intlResponse = handleI18nRouting(request);
  return updateSession(request, intlResponse);
}

export const config = {
  matcher: [
    // api/ excluded: locale routing and session-cookie refresh are both
    // meaningless for API routes — found while adding the reminders
    // cron endpoint, which was getting redirected to a locale-prefixed
    // path (breaking Vercel Cron's invocation, not just local curl
    // testing) before this exclusion existed.
    //
    // robots.txt / sitemap.xml excluded for the same reason: they're
    // root-level files (Next's app/robots.ts + app/sitemap.ts), and
    // localePrefix "always" was redirecting /robots.txt -> /bg/robots.txt,
    // which crawlers fetching the root file never see — breaking both.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

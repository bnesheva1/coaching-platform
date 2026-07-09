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
  if (request.nextUrl.pathname === "/auth/callback") return authCallbackLimiter;
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

  const intlResponse = handleI18nRouting(request);
  return updateSession(request, intlResponse);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

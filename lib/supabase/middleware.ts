import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { extractLocale, stripLocale } from "@/lib/locale-path";

// `response` is whatever next-intl's own middleware already decided
// (a locale redirect, or a pass-through) — we layer Supabase's session
// cookies onto it rather than starting a fresh response, so neither
// system's cookies/headers get dropped.
export async function updateSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the auth token if it's expired — required so Server
  // Components always see a valid session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If next-intl is redirecting (e.g. adding a missing locale prefix),
  // check the *destination* path for protection, not the original
  // request path — that's the path that will actually get rendered.
  const redirectLocation = response.headers.get("location");
  const pathToCheck = redirectLocation
    ? new URL(redirectLocation, request.url).pathname
    : request.nextUrl.pathname;

  const locale = extractLocale(pathToCheck) ?? routing.defaultLocale;
  const pathWithoutLocale = stripLocale(pathToCheck);

  const protectedPaths = ["/practitioner-dashboard", "/client-dashboard"];
  const isProtectedPath = protectedPaths.some((path) =>
    pathWithoutLocale.startsWith(path),
  );

  if (!user && isProtectedPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  return response;
}

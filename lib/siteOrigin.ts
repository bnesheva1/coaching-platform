import { headers } from "next/headers";

// Derives the site's own origin from the incoming request's own Host
// header rather than a NEXT_PUBLIC_SITE_URL env var — any absolute
// redirect URL built from this (Stripe Checkout's success_url/cancel_url,
// Connect's return_url/refresh_url) is always correct for whatever
// origin the client is actually on (localhost, a preview deployment, the
// real domain) with nothing to keep in sync if the domain ever changes.
export async function siteOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

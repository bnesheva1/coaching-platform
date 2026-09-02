import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Server Actions receive uploads as multipart bodies, so this framework
// limit must sit ABOVE the largest file any action accepts — otherwise a
// too-large body is rejected by Next BEFORE our own friendly size check
// runs. The binding case is a session document (SESSION_DOCUMENT_MAX_BYTES,
// default 10MB); avatars (2MB) are well under it. A file AT the cap plus
// multipart boundaries and the action's other form fields exceeds the cap
// itself, so we add ~2MB of headroom — and mirror the env default here so
// raising the document cap raises this in step (read at build/start; unset
// ⇒ the same 10MB default as lib/documents/config.ts).
function serverActionBodyLimitBytes(): number {
  const raw = process.env.SESSION_DOCUMENT_MAX_BYTES;
  const parsed = raw && raw.trim() !== "" ? Number(raw) : NaN;
  const docMax = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10 * 1024 * 1024;
  return docMax + 2 * 1024 * 1024;
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: serverActionBodyLimitBytes(),
    },
  },
  async redirects() {
    return [
      {
        // Old Vercel alias → the real domain, 308 permanent (permanent: true).
        // Stops the old host serving duplicate content at all, and — since auth
        // links are built from the REQUEST host, not SITE_URL — it means anyone
        // arriving on an old link completes signup/reset on the correct host.
        // The path (and query) carry over via :path*. Matched on the exact old
        // host only, so the live domain (www.samodapopitam.bg) never matches and
        // can't loop. Deployment-specific *.vercel.app preview URLs aren't
        // covered (not indexed/shared); broaden the host match if that changes.
        source: "/:path*",
        has: [{ type: "host", value: "coaching-platform-tau.vercel.app" }],
        destination: "https://www.samodapopitam.bg/:path*",
        permanent: true,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);

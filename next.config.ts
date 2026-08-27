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
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);

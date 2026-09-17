// Gated content is YouTube-unlisted ONLY for v1, so this is a focused,
// self-contained YouTube parser (not the multi-platform lib/videos.ts) — which
// keeps it unit-testable via a plain `node` run with no import chain. Same
// strictness principles as lib/videos: real URL parsing (no substring host
// checks, so youtube.com.evil.example never matches) and a final 11-char id gate.

const BARE_YT_ID = /^[A-Za-z0-9_-]{11}$/; // YouTube ids are exactly 11 of these.
const YT_HOSTS = new Set(["youtube.com", "youtu.be"]);

// Accept either a bare 11-char id or a clean YouTube watch/share/embed/shorts
// URL, and return the validated id. Reject everything else — a pasted <iframe>,
// another site's link, a Vimeo URL, a look-alike host, or garbage — by returning
// null. The caller stores ONLY this id; the app builds the embed URL from it.
export function parseYoutubeInput(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (BARE_YT_ID.test(s)) return s;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!YT_HOSTS.has(host)) return null;

  let id: string | null = null;
  if (host === "youtube.com") {
    if (u.pathname === "/watch") {
      id = u.searchParams.get("v");
    } else {
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/);
      if (m) id = m[1];
    }
  } else {
    // youtu.be/<id>
    const m = u.pathname.match(/^\/([^/]+)$/);
    if (m) id = m[1];
  }
  return id && BARE_YT_ID.test(id) ? id : null;
}

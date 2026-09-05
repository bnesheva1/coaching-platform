// Video URL handling for the practitioner profile Videos section. The admin UI
// only ever accepts a plain watch/share URL (never embed HTML); everything here
// runs server-side. We validate against an EXACT host allowlist, extract the id
// with a strict per-platform regex (no fuzzy/permissive parsing — anything that
// doesn't match cleanly is rejected), and the app builds the embed URL itself
// from platform + id so user-supplied markup is never rendered.

export type VideoPlatform = "youtube" | "vimeo";

export type ParsedVideo = { platform: VideoPlatform; videoId: string };

// Exactly the hosts the spec allows. A leading "www." is stripped before the
// check (so www.youtube.com is accepted as youtube.com), but nothing else — a
// lookalike like youtube.com.evil.example never matches, since URL parsing gives
// the true host.
const ALLOWED_HOSTS = new Set(["youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com"]);

const YT_ID = /^[A-Za-z0-9_-]{11}$/; // YouTube ids are exactly 11 of these chars.
const VIMEO_ID = /^[0-9]+$/;

function normalizeHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

// Returns the platform + canonical id, or null if the URL isn't a cleanly
// matching YouTube/Vimeo link on an allowed host.
export function parseVideoUrl(raw: string): ParsedVideo | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = normalizeHost(u.hostname);
  if (!ALLOWED_HOSTS.has(host)) return null;

  // --- YouTube ---
  if (host === "youtu.be") {
    // youtu.be/<id>
    const id = u.pathname.slice(1);
    return YT_ID.test(id) ? { platform: "youtube", videoId: id } : null;
  }
  if (host === "youtube.com") {
    // /watch?v=<id>
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v") ?? "";
      return YT_ID.test(id) ? { platform: "youtube", videoId: id } : null;
    }
    // /embed/<id> and /shorts/<id> (unambiguous share forms, still strict)
    const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/);
    if (m && YT_ID.test(m[1])) return { platform: "youtube", videoId: m[1] };
    return null;
  }

  // --- Vimeo ---
  if (host === "vimeo.com") {
    // vimeo.com/<digits> (optionally followed by a privacy hash segment)
    const m = u.pathname.match(/^\/([0-9]+)(?:\/[A-Za-z0-9]+)?$/);
    return m && VIMEO_ID.test(m[1]) ? { platform: "vimeo", videoId: m[1] } : null;
  }
  if (host === "player.vimeo.com") {
    // player.vimeo.com/video/<digits>
    const m = u.pathname.match(/^\/video\/([0-9]+)$/);
    return m && VIMEO_ID.test(m[1]) ? { platform: "vimeo", videoId: m[1] } : null;
  }

  return null;
}

// The embed URL the app constructs itself — never derived from user markup.
export function buildEmbedUrl(platform: VideoPlatform, videoId: string): string {
  return platform === "youtube"
    ? `https://www.youtube.com/embed/${videoId}`
    : `https://player.vimeo.com/video/${videoId}`;
}

// Deterministic YouTube thumbnail (no API needed) — used as a fallback if oEmbed
// doesn't return one.
function youtubeThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// Fetch the title + thumbnail via the platform's oEmbed endpoint at add time.
// Best-effort: on any failure we still return a usable thumbnail for YouTube
// (deterministic) and null title, so a flaky oEmbed never blocks adding a video.
export async function fetchVideoOEmbed(
  platform: VideoPlatform,
  rawUrl: string,
  videoId: string,
): Promise<{ title: string | null; thumbnailUrl: string | null }> {
  const endpoint =
    platform === "youtube"
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(rawUrl)}`;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`oembed ${res.status}`);
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };
    return {
      title: typeof data.title === "string" ? data.title : null,
      thumbnailUrl:
        typeof data.thumbnail_url === "string"
          ? data.thumbnail_url
          : platform === "youtube"
            ? youtubeThumb(videoId)
            : null,
    };
  } catch {
    return { title: null, thumbnailUrl: platform === "youtube" ? youtubeThumb(videoId) : null };
  }
}

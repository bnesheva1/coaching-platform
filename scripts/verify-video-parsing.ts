// Video URL parsing/validation — unit checks for lib/videos.ts (no DB, no server).
// Run: node scripts/verify-video-parsing.ts
import { parseVideoUrl, buildEmbedUrl } from "../lib/videos.ts";

let failures = 0;
const eq = (label: string, got: unknown, expect: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(expect);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${pass ? "" : `  (got ${JSON.stringify(got)}, expected ${JSON.stringify(expect)})`}`);
};
const key = (u: string) => {
  const p = parseVideoUrl(u);
  return p ? `${p.platform}:${p.videoId}` : null;
};

console.log("=== accepted (allowed hosts, strict ids) ===");
eq("youtube watch", key("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube:dQw4w9WgXcQ");
eq("youtube watch + extra params", key("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=abc"), "youtube:dQw4w9WgXcQ");
eq("youtu.be short", key("https://youtu.be/dQw4w9WgXcQ"), "youtube:dQw4w9WgXcQ");
eq("youtube /embed/", key("https://www.youtube.com/embed/dQw4w9WgXcQ"), "youtube:dQw4w9WgXcQ");
eq("youtube /shorts/", key("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "youtube:dQw4w9WgXcQ");
eq("vimeo", key("https://vimeo.com/123456789"), "vimeo:123456789");
eq("vimeo + privacy hash", key("https://vimeo.com/123456789/abc123"), "vimeo:123456789");
eq("player.vimeo", key("https://player.vimeo.com/video/123456789"), "vimeo:123456789");

console.log("\n=== rejected (host not on allowlist, or id doesn't match cleanly) ===");
eq("lookalike host suffix", key("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"), null);
eq("evil host", key("https://evil.com/watch?v=dQw4w9WgXcQ"), null);
eq("dailymotion", key("https://www.dailymotion.com/video/x7tgz2z"), null);
eq("youtube bad id length", key("https://www.youtube.com/watch?v=short"), null);
eq("youtube no id", key("https://www.youtube.com/watch"), null);
eq("vimeo non-numeric", key("https://vimeo.com/abcdef"), null);
eq("embed HTML rejected (not a URL)", key('<iframe src="https://youtube.com/embed/dQw4w9WgXcQ"></iframe>'), null);
eq("javascript: scheme", key("javascript:alert(1)"), null);
eq("empty", key(""), null);

console.log("\n=== app-built embed URLs ===");
eq("youtube embed", buildEmbedUrl("youtube", "dQw4w9WgXcQ"), "https://www.youtube.com/embed/dQw4w9WgXcQ");
eq("vimeo embed", buildEmbedUrl("vimeo", "123456789"), "https://player.vimeo.com/video/123456789");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;

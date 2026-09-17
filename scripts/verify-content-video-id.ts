// Step 7: the gated-content video-id validator rejects malicious / malformed
// input and accepts only a clean YouTube id or URL. Pure unit test.
//
// Run: node scripts/verify-content-video-id.ts

import { parseYoutubeInput } from "../lib/content/video.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

// --- Rejected (return null) ---
check("rejects a pasted <iframe> tag", parseYoutubeInput('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>') === null);
check("rejects a non-YouTube URL", parseYoutubeInput("https://evil.example.com/watch?v=dQw4w9WgXcQ") === null);
check("rejects a YouTube look-alike host", parseYoutubeInput("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ") === null);
check("rejects a Vimeo URL (YouTube-only for v1)", parseYoutubeInput("https://vimeo.com/123456789") === null);
check("rejects a script tag", parseYoutubeInput('<script>alert(1)</script>') === null);
check("rejects garbage", parseYoutubeInput("not a video at all") === null);
check("rejects an over-long id", parseYoutubeInput("dQw4w9WgXcQEXTRA") === null);
check("rejects empty", parseYoutubeInput("   ") === null);

// --- Accepted (return the 11-char id) ---
check("accepts a bare 11-char id", parseYoutubeInput("dQw4w9WgXcQ") === "dQw4w9WgXcQ");
check("accepts a full watch URL", parseYoutubeInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ");
check("accepts a youtu.be short URL", parseYoutubeInput("https://youtu.be/dQw4w9WgXcQ") === "dQw4w9WgXcQ");
check("accepts a URL with extra query params", parseYoutubeInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s") === "dQw4w9WgXcQ");

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);

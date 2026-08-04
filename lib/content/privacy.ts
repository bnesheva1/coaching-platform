import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Server-only (fs) — the privacy policy's actual text lives in plain
// markdown files under content/privacy-policy/, not in messages/*.json
// or a component. This is deliberate: a legal document gets edited by
// non-developers, repeatedly, without a code review — keeping it out of
// the translation files (which mix in every short UI label in the app)
// and out of any .tsx file means editing it is just editing a .md file,
// nothing else. `lastUpdated` lives in the file's own frontmatter for
// the same reason: the person changing the policy text is the same
// person who should be updating the date, in the same file, not a
// separate constant somewhere in the codebase.
export type PrivacyPolicyContent = {
  lastUpdated: string;
  body: string;
};

const SUPPORTED_LOCALES = ["en", "bg"] as const;

export function getPrivacyPolicyContent(locale: string): PrivacyPolicyContent {
  const safeLocale = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : "bg";
  const filePath = path.join(process.cwd(), "content", "privacy-policy", `${safeLocale}.md`);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  return {
    lastUpdated: typeof data.lastUpdated === "string" ? data.lastUpdated : "",
    body: content,
  };
}

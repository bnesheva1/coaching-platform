import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";
import { getTranslations } from "next-intl/server";
import reservedSpecialtyWords from "@/data/reserved-specialty-words.json";

// (a) Maintainable hardcoded list — platform/system terms that would be
// confusing or exploitable as a username (e.g. impersonating support).
const HARDCODED_RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "support",
  "help",
  "staff",
  "team",
  "moderator",
  "root",
  "system",
  "official",
  "api",
  "app",
  "www",
  "mail",
  "info",
  "contact",
  "billing",
  "payments",
  "security",
  "about",
  "terms",
  "privacy",
  "blog",
  "faq",
  "pricing",
  "careers",
  "press",
  "legal",
  "status",
  "practitioner",
  "client",
  "coach",
  "user",
  "profile",
  "account",
  "me",
  "null",
  "undefined",
  "true",
  "false",
  "none",
  "test",
];

// (b) Combined with the specialty-term list from data/reserved-specialty-words.json.
// Both sources are checked identically: exact match against the whole
// normalized candidate, never a substring/contains check. That distinction
// matters — a substring check would wrongly reject valid personalized
// handles like "tina-astrology" just for containing "astrology".
const RESERVED_USERNAMES = new Set<string>(
  [...HARDCODED_RESERVED_USERNAMES, ...(reservedSpecialtyWords as string[])].map(
    (word) => word.toLowerCase(),
  ),
);

// Profanity/slur detection uses `obscenity` (see explanation in chat) — this
// one deliberately DOES scan for matches anywhere in the string, unlike the
// reserved-word check above. That's intentional: reserved words guard
// specific whole handles ("astrology" the exact word), while profanity
// needs to catch a slur embedded anywhere ("fuck-my-life" isn't a reserved
// word match, but should still be blocked).
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const USERNAME_FORMAT = /^[a-z0-9_-]+$/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type UsernameValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string };

// Async because the error messages need translating (getTranslations is
// the Server-Action/Server-Component-safe way to do that, same as
// everywhere else translated strings are produced outside of a rendered
// component tree).
export async function validateUsernameFormat(
  raw: string,
): Promise<UsernameValidationResult> {
  const normalized = normalizeUsername(raw);
  const t = await getTranslations("Profile");

  if (normalized.length < MIN_USERNAME_LENGTH) {
    return {
      valid: false,
      reason: t("usernameTooShort", { min: MIN_USERNAME_LENGTH }),
    };
  }

  if (normalized.length > MAX_USERNAME_LENGTH) {
    return {
      valid: false,
      reason: t("usernameTooLong", { max: MAX_USERNAME_LENGTH }),
    };
  }

  if (!USERNAME_FORMAT.test(normalized)) {
    return {
      valid: false,
      reason: t("usernameInvalidChars"),
    };
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    return { valid: false, reason: t("usernameReserved") };
  }

  if (profanityMatcher.hasMatch(normalized)) {
    return { valid: false, reason: t("usernameNotAllowed") };
  }

  return { valid: true, normalized };
}

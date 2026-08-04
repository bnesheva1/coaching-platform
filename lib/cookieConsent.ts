import { cookies } from "next/headers";

// One cookie, one boolean — essential storage (auth session, language
// preference, theme) is never opted out of, so there's nothing to
// record about it; the only real choice a visitor makes is analytics,
// which isn't set today at all (no analytics provider is wired up yet
// — see project memory). This exists now so switching analytics on
// later is just "start reading this value," not "build consent from
// scratch after tracking already started."
const COOKIE_NAME = "cc_consent";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — re-asked annually, not forever

export type CookieConsent = { analytics: boolean; ts: string };

export async function getCookieConsent(): Promise<CookieConsent | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.analytics === "boolean" && typeof parsed?.ts === "string") {
      return parsed as CookieConsent;
    }
  } catch {
    // Malformed/tampered cookie — treated the same as "no choice yet,"
    // not an error; the banner just shows again.
  }
  return null;
}

export async function setCookieConsent(analytics: boolean): Promise<void> {
  const store = await cookies();
  const value: CookieConsent = { analytics, ts: new Date().toISOString() };
  store.set(COOKIE_NAME, JSON.stringify(value), {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
  });
}

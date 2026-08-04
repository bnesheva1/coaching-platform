"use server";

import { revalidatePath } from "next/cache";
import { setCookieConsent } from "@/lib/cookieConsent";

// Locale-independent (this file lives outside app/[locale] on purpose)
// — the consent cookie itself has no language, and this action is
// called from both the banner (mounted in the locale-scoped root
// layout) and the standalone /cookie-preferences page.
export async function recordCookieConsent(analytics: boolean) {
  await setCookieConsent(analytics);
  // Revalidates the current path so a server-rendered "current choice"
  // read (the /cookie-preferences page's own initial toggle state)
  // reflects the just-saved value immediately, without a full reload.
  revalidatePath("/", "layout");
}

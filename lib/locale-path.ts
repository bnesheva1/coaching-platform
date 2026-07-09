import { routing } from "@/i18n/routing";

const localePattern = routing.locales.join("|");
const localePrefixRegex = new RegExp(`^/(${localePattern})(?=/|$)`);

export function extractLocale(pathname: string): string | null {
  const match = pathname.match(localePrefixRegex);
  return match ? match[1] : null;
}

export function stripLocale(pathname: string): string {
  return pathname.replace(localePrefixRegex, "") || "/";
}

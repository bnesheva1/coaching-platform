import type { Metadata } from "next";
import { PT_Serif, Manrope, JetBrains_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/header/SiteHeader";
import { SiteFooter } from "@/components/footer/SiteFooter";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { CookieConsentBanner } from "@/components/cookie-consent/CookieConsentBanner";
import { getCookieConsent } from "@/lib/cookieConsent";
import { SITE_URL } from "@/lib/seo";
import "../globals.css";

// Bulgarian-first app — cyrillic is an explicit subset on every font,
// not assumed. next/font self-hosts these (no runtime CDN @import),
// matching how Geist was already loaded here.
const fontDisplay = PT_Serif({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const fontUi = Manrope({
  variable: "--font-ui",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
});

// metadataBase — needed for every page's relative/absolute URL resolution
// in metadata (og:image, alternates, etc.) to produce correct absolute
// URLs instead of Next's own build-time-inferred fallback. This
// locale-aware fallback title/description only ever shows on a route
// that doesn't set its own generateMetadata (Next merges child metadata
// over this, doesn't replace the whole object) — every real page this
// session touches sets its own.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HomePage" });
  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("metaDescription"),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Read once, server-side, so a returning visitor who already chose
  // never sees the banner flash before disappearing — it's simply never
  // rendered in that case, not rendered-then-hidden client-side.
  const consent = await getCookieConsent();

  return (
    <html
      lang={locale}
      className={`${fontDisplay.variable} ${fontUi.variable} ${fontMono.variable} h-full antialiased`}
      // The theme is decided client-side, before paint, by next-themes'
      // own blocking script (see ThemeProvider) — the server can't know
      // the visitor's localStorage or OS preference, so the data-theme
      // attribute legitimately differs between server-rendered HTML and
      // the client DOM immediately after that script runs. Expected,
      // not a bug being silenced.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider>
            {/* Mounted once, here — not per-page — so every route gets
                the same header by construction; no page can forget it.
                Replaces both the old fixed-corner LanguageSwitcher and
                the three hand-copied NavBar wiring blocks (homepage,
                client-dashboard layout, practitioner-dashboard layout). */}
            <SiteHeader />
            {/* flex: 1 (body is already flex/column, see className above)
                pins SiteFooter to the bottom of the viewport on short
                pages instead of it floating up right under the content. */}
            <div style={{ flex: 1 }}>{children}</div>
            <SiteFooter />
            {consent === null && <CookieConsentBanner />}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

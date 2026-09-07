import { ImageResponse } from "next/og";
import { resolveBrand, brandLocales } from "@/lib/brand-config";
import bgMessages from "@/messages/bg.json";
import enMessages from "@/messages/en.json";

// Default social share image (og:image / twitter:image). White-label: the only
// text on it is the deployment's own site name, resolved from the SAME brand
// config that drives everything else (BRAND env → resolveBrand, brandLocales,
// Brand.siteName/siteNameTwo). No brand name/text is hardcoded here. Lives under
// /api/ so the locale middleware leaves it alone (same as sitemap/robots).
//
// Framework-free name resolution (mirrors lib/brand.ts's getSiteName) rather than
// next-intl, since this route handler runs outside the [locale] request scope.
const ALL_MESSAGES = { bg: bgMessages, en: enMessages } as const;

function resolveSiteName(): string {
  const brand = resolveBrand();
  const locale = (brandLocales()[0] ?? "bg") as keyof typeof ALL_MESSAGES;
  const brandMessages = (ALL_MESSAGES[locale] ?? ALL_MESSAGES.bg).Brand;
  return brand === "two" ? brandMessages.siteNameTwo : brandMessages.siteName;
}

// Satori (next/og) ships only a Latin default face, so a Cyrillic site name would
// render as tofu. Pull a Bold face, subset to exactly the name's glyphs, from
// Google Fonts (a legacy UA forces ttf — satori can't parse woff2). Best-effort:
// any failure falls back to the default face rather than failing the image.
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    // Legacy UA on BOTH requests so gstatic serves ttf (its /l/font subset URL is
    // extension-less, and modern UAs get woff2, which satori can't parse).
    const UA = "Mozilla/4.0";
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans:wght@700&text=${encodeURIComponent(text)}`,
      { headers: { "User-Agent": UA } },
    ).then((r) => r.text());
    const src = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!src) return null;
    return await fetch(src, { headers: { "User-Agent": UA } }).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET() {
  const siteName = resolveSiteName();
  const font = await loadFont(siteName);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b1220 0%, #131c31 100%)",
          padding: 96,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: font ? "Site" : undefined,
            fontSize: 88,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            textAlign: "center",
          }}
        >
          {siteName}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: font ? [{ name: "Site", data: font, weight: 700, style: "normal" }] : undefined,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}

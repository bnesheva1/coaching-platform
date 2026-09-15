import { getTranslations } from "next-intl/server";
import { NavBar, type NavLink } from "@/components/ui/NavBar";
import { PillNav, type MegaMenuLink } from "./PillNav";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LangToggle } from "./LangToggle";
import { routing } from "@/i18n/routing";
import { getViewer } from "@/lib/auth/getViewer";
import { getSiteName, resolveBrand, layoutBrand } from "@/lib/brand";
import { signOut } from "@/app/actions";

// The one header, mounted once in app/[locale]/layout.tsx — every route
// gets it by construction, not by each page/layout remembering to
// import it. Does its own auth+role lookup (getViewer) and renders the
// NavBar primitive with role-appropriate content; NavBar itself stays
// auth-agnostic; it just reshapes whatever structured data it's given
// into the desktop 3-zone layout vs the mobile flat list.
export async function SiteHeader() {
  const siteName = await getSiteName();
  const tBrowse = await getTranslations("Browse");
  const tHeader = await getTranslations("Header");
  const tFooter = await getTranslations("Footer");
  const viewer = await getViewer();

  // Brand two overrides the nav wording to the handoff labels (wordmark "само да
  // попитам" via getSiteName, "Специалисти", "Моите срещи", "Полезно"); brand one
  // keeps its own. The links, order, and role logic are identical either way —
  // only the labels differ.
  // Brand three uses brand two's header (wordmark styling, "Полезно" dropdown);
  // layoutBrand maps three → two.
  const brand = layoutBrand();

  const browseLink = {
    label:
      brand === "two"
        ? tHeader("specialistsLink")
        : viewer.status === "practitioner"
          ? tHeader("browseLinkPractitioner")
          : tBrowse("title"),
    href: "/browse",
  };

  const infoDropdownLabel = brand === "two" ? tHeader("usefulDropdownLabel") : tHeader("infoDropdownLabel");

  // The 5 marketing/info pages — same for every viewer, unlike
  // browseLink/dashboardLink/authLinks below. Reuses Footer's own
  // labels for About/FAQ/Contact rather than duplicating those 3
  // strings under Header too.
  // Descriptions (Header namespace) are shown only by the brand-three PillNav
  // mega-menu + drawer; NavBar (warm/two) ignores the extra field. All five
  // sit under Header for one lookup, even where the label comes from Footer.
  const infoLinks: MegaMenuLink[] = [
    { label: tHeader("howItWorksLink"), href: "/kak-raboti", description: tHeader("howItWorksDesc") },
    { label: tHeader("becomePractitionerLink"), href: "/stani-specialist", description: tHeader("becomePractitionerDesc") },
    { label: tFooter("aboutLink"), href: "/about", description: tHeader("aboutDesc") },
    { label: tFooter("faqLink"), href: "/vaprosi", description: tHeader("faqDesc") },
    { label: tFooter("contactLink"), href: "/kontakti", description: tHeader("contactDesc") },
  ];

  const isLoggedIn = viewer.status !== "logged-out";
  const isPractitioner = viewer.status === "practitioner";
  const isAdmin = viewer.status === "admin";
  const dashboardHref = isPractitioner ? "/practitioner-dashboard" : "/client-dashboard";

  // The always-visible link to their own area. Role-specific wording:
  // "Моите сесии" describes what's actually there for a client, whereas
  // "Dashboard" is the wrong word for them; the practitioner keeps a
  // dashboard framing. Mutually exclusive with authLinks — exactly one of
  // the two is non-null.
  // An admin has no client/practitioner area, so no visible top-nav link —
  // /admin is reachable from the account menu only (see accountLinks).
  const dashboardLink =
    isLoggedIn && !isAdmin
      ? {
          label:
            brand === "two"
              ? tHeader("myMeetingsLink")
              : isPractitioner
                ? tHeader("dashboardLinkPractitioner")
                : tHeader("dashboardLinkClient"),
          href: dashboardHref,
        }
      : null;

  // The greeting is now the account-menu trigger; it still does identity
  // work (whose account you're in). Falls back to the plain dashboard label
  // on the rare missing-display_name case rather than "Привет, " with
  // nothing after it.
  const greetingText = isLoggedIn
    ? tHeader("greeting", { name: viewer.displayName ?? tHeader("dashboardLink") })
    : null;

  // Account-level only, never content navigation. Practitioners also get a
  // link to their own public profile (/p/{username}); if they haven't set a
  // username yet, point at the dashboard profile editor so it never 404s.
  const accountLinks: NavLink[] | null = !isLoggedIn
    ? null
    : isAdmin
      ? // Admin: the /admin link lives here in the account menu, shown only to
        // admins — never in public nav.
        [{ label: tHeader("adminLink"), href: "/admin" }]
      : isPractitioner
        ? [
            {
              label: tHeader("myProfile"),
              href: viewer.username ? `/p/${viewer.username}` : "/practitioner-dashboard/profile",
            },
            { label: tHeader("settings"), href: "/practitioner-dashboard/settings" },
          ]
        : [{ label: tHeader("settings"), href: "/client-dashboard/settings" }];

  const signOutItem = isLoggedIn ? { label: tHeader("signOut"), action: signOut } : null;

  const authLinks = isLoggedIn
    ? null
    : [
        { label: tHeader("login"), href: "/login", variant: "ghost" as const },
        { label: tHeader("register"), href: "/signup", variant: "primary" as const },
      ];

  const headerProps = {
    wordmark: siteName,
    navLabel: tHeader("navPrimaryLabel"),
    browseLink,
    infoDropdownLabel,
    infoLinks,
    dashboardLink,
    greetingText,
    accountLinks,
    signOut: signOutItem,
    authLinks,
    langToggle: routing.locales.length > 1 ? <LangToggle /> : null,
    themeToggle: <ThemeToggle compact switchToLightLabel={tHeader("switchToLight")} switchToDarkLabel={tHeader("switchToDark")} />,
    mobileMenuLabel: { open: tHeader("mobileMenuOpen"), close: tHeader("mobileMenuClose") },
  };

  // Brand three gets the floating-pill / mega-menu header; warm and brand two
  // keep the existing NavBar. Same structured data either way — a presentation
  // swap, not new navigation. (resolveBrand, not layoutBrand: this is the one
  // place brand three must differ from brand two, not inherit it.)
  return resolveBrand() === "three" ? <PillNav {...headerProps} /> : <NavBar {...headerProps} />;
}

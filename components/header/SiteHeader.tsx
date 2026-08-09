import { getTranslations } from "next-intl/server";
import { NavBar, type NavLink } from "@/components/ui/NavBar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LangToggle } from "./LangToggle";
import { getViewer } from "@/lib/auth/getViewer";
import { signOut } from "@/app/actions";

// The one header, mounted once in app/[locale]/layout.tsx — every route
// gets it by construction, not by each page/layout remembering to
// import it. Does its own auth+role lookup (getViewer) and renders the
// NavBar primitive with role-appropriate content; NavBar itself stays
// auth-agnostic; it just reshapes whatever structured data it's given
// into the desktop 3-zone layout vs the mobile flat list.
export async function SiteHeader() {
  const tHome = await getTranslations("HomePage");
  const tBrowse = await getTranslations("Browse");
  const tHeader = await getTranslations("Header");
  const tFooter = await getTranslations("Footer");
  const viewer = await getViewer();

  const browseLink = {
    label: viewer.status === "practitioner" ? tHeader("browseLinkPractitioner") : tBrowse("title"),
    href: "/browse",
  };

  // The 5 marketing/info pages — same for every viewer, unlike
  // browseLink/dashboardLink/authLinks below. Reuses Footer's own
  // labels for About/FAQ/Contact rather than duplicating those 3
  // strings under Header too.
  const infoLinks = [
    { label: tHeader("howItWorksLink"), href: "/how-it-works" },
    { label: tHeader("becomePractitionerLink"), href: "/become-a-practitioner" },
    { label: tFooter("aboutLink"), href: "/about" },
    { label: tFooter("faqLink"), href: "/faq" },
    { label: tFooter("contactLink"), href: "/contact" },
  ];

  const isLoggedIn = viewer.status !== "logged-out";
  const isPractitioner = viewer.status === "practitioner";
  const dashboardHref = isPractitioner ? "/practitioner-dashboard" : "/client-dashboard";

  // The always-visible link to their own area. Role-specific wording:
  // "Моите сесии" describes what's actually there for a client, whereas
  // "Dashboard" is the wrong word for them; the practitioner keeps a
  // dashboard framing. Mutually exclusive with authLinks — exactly one of
  // the two is non-null.
  const dashboardLink = isLoggedIn
    ? { label: isPractitioner ? tHeader("dashboardLinkPractitioner") : tHeader("dashboardLinkClient"), href: dashboardHref }
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

  return (
    <NavBar
      wordmark={tHome("title")}
      browseLink={browseLink}
      infoDropdownLabel={tHeader("infoDropdownLabel")}
      infoLinks={infoLinks}
      dashboardLink={dashboardLink}
      greetingText={greetingText}
      accountLinks={accountLinks}
      signOut={signOutItem}
      authLinks={authLinks}
      langToggle={<LangToggle />}
      themeToggle={<ThemeToggle compact switchToLightLabel={tHeader("switchToLight")} switchToDarkLabel={tHeader("switchToDark")} />}
      mobileMenuLabel={{ open: tHeader("mobileMenuOpen"), close: tHeader("mobileMenuClose") }}
    />
  );
}

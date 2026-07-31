import { getTranslations } from "next-intl/server";
import { NavBar } from "@/components/ui/NavBar";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LangToggle } from "./LangToggle";
import { getViewer } from "@/lib/auth/getViewer";

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

  const dashboardHref = viewer.status === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard";
  // Mutually exclusive with authLinks below — exactly one is non-null.
  const isLoggedIn = viewer.status !== "logged-out";
  const dashboardLink = isLoggedIn ? { label: tHeader("dashboardLink"), href: dashboardHref } : null;
  // Falls back to the plain dashboard label on the (rare, already-
  // handled-elsewhere) case of a missing display_name, rather than
  // rendering "Привет, " with nothing after it.
  const greetingText = isLoggedIn
    ? tHeader("greeting", { name: viewer.displayName ?? tHeader("dashboardLink") })
    : null;
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
      authLinks={authLinks}
      langToggle={<LangToggle />}
      themeToggle={<ThemeToggle compact switchToLightLabel={tHeader("switchToLight")} switchToDarkLabel={tHeader("switchToDark")} />}
      mobileMenuLabel={{ open: tHeader("mobileMenuOpen"), close: tHeader("mobileMenuClose") }}
    />
  );
}

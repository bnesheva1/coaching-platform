import { getTranslations } from "next-intl/server";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LangToggle } from "./LangToggle";
import { getViewer } from "@/lib/auth/getViewer";

// The one header, mounted once in app/[locale]/layout.tsx — every route
// gets it by construction, not by each page/layout remembering to
// import it. Does its own auth+role lookup (getViewer) and renders the
// existing NavBar primitive with role-appropriate content; NavBar
// itself stays auth-agnostic, same split as before this consolidation.
export async function SiteHeader() {
  const tHome = await getTranslations("HomePage");
  const tBrowse = await getTranslations("Browse");
  const tHeader = await getTranslations("Header");
  const viewer = await getViewer();

  const browseLabel = viewer.status === "practitioner" ? tHeader("browseLinkPractitioner") : tBrowse("title");
  const dashboardHref = viewer.status === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard";

  const actions =
    viewer.status === "logged-out" ? (
      <>
        <Button variant="ghost" size="sm" href="/login">
          {tHeader("login")}
        </Button>
        <Button variant="primary" size="sm" href="/signup">
          {tHeader("register")}
        </Button>
      </>
    ) : (
      // Just the one Табло link — no separate account-menu icon. Sign
      // out lives in the dashboard sidebar now (see DashboardSidebar.tsx/
      // ClientDashboardSidebar.tsx), not duplicated here.
      <Button variant="ghost" size="sm" href={dashboardHref}>
        {tHeader("dashboardLink")}
      </Button>
    );

  return (
    <NavBar
      wordmark={tHome("title")}
      links={[{ label: browseLabel, href: "/browse" }]}
      langToggle={<LangToggle />}
      themeToggle={<ThemeToggle compact switchToLightLabel={tHeader("switchToLight")} switchToDarkLabel={tHeader("switchToDark")} />}
      actions={actions}
      mobileMenuLabel={{ open: tHeader("mobileMenuOpen"), close: tHeader("mobileMenuClose") }}
    />
  );
}

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";

// Mounted once in app/[locale]/layout.tsx, alongside SiteHeader — every
// route gets it by construction. Unlike SiteHeader, this doesn't do a
// viewer/role lookup: a footer is a site directory, the same for every
// visitor regardless of auth state (SiteHeader's role-adaptive links are
// about what's actionable right now; these are just "here's the whole
// site," which doesn't change per role).
export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const tHome = await getTranslations("HomePage");
  const siteName = tHome("title");
  const year = new Date().getFullYear();

  const links: { href: string; label: string }[] = [
    { href: "/how-it-works", label: t("howItWorksLink") },
    { href: "/become-a-practitioner", label: t("becomePractitionerLink") },
    { href: "/about", label: t("aboutLink") },
    { href: "/faq", label: t("faqLink") },
    { href: "/contact", label: t("contactLink") },
    { href: "/browse", label: t("browseLink") },
  ];

  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-page)",
        marginTop: "var(--space-16)",
      }}
    >
      <ContentContainer>
        <div
          style={{
            padding: "var(--space-8) 0",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {/* Distinct aria-label from NavBar's own <nav> — without it,
              screen reader users see two unlabeled "navigation" landmarks
              with no way to tell them apart in the landmarks list. */}
          <nav aria-label={t("navLabel")} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2) var(--space-5)" }}>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{ font: "var(--text-nav)", color: "var(--text-secondary)", textDecoration: "none" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <p style={{ font: "var(--text-caption)", color: "var(--text-tertiary)", margin: 0 }}>
            {t("copyright", { year, siteName })}
          </p>
        </div>
      </ContentContainer>
    </footer>
  );
}

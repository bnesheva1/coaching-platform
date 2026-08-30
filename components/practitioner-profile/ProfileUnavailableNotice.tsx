import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";

// Shown on a public profile URL when the practitioner is fully hidden (lapsed
// with no outstanding bookings — see is_practitioner_fully_hidden). Deliberately
// NOT a 404: the person existed and may return, and a "not found" would tell a
// returning client they never existed. A quiet, neutral notice instead — no
// reason, no blame, no mention of billing (that's the practitioner's private
// matter) — with a way onward to browse.
export async function ProfileUnavailableNotice() {
  const t = await getTranslations("PublicProfile");
  return (
    <main style={{ padding: "var(--space-8) 0" }}>
      <ContentContainer maxWidth={"var(--content-max-width)"}>
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-4)",
            padding: "var(--space-8) var(--space-4)",
          }}
        >
          <h1 style={{ margin: 0, font: "var(--text-heading-md)", color: "var(--text-primary)" }}>
            {t("notListedTitle")}
          </h1>
          <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)", maxWidth: "46ch" }}>
            {t("notListedBody")}
          </p>
          <Link href="/browse" style={{ font: "var(--text-body-md)", fontWeight: 600, color: "var(--accent)" }}>
            {t("notListedBrowse")}
          </Link>
        </div>
      </ContentContainer>
    </main>
  );
}

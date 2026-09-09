import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, socialMetadata } from "@/lib/seo";
import { getSiteName, resolveBrand } from "@/lib/brand";
import { ContactForm } from "./ContactForm";
import kit from "@/components/brand-two-pages/kit.module.css";
import { Eyebrow } from "@/components/brand-two-pages/kit";
import { Mail, Users, Heart } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  const siteName = await getSiteName(locale);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: localizedAlternates(locale, "/kontakti"),
    ...socialMetadata({ title, description, siteName, locale }),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("Contact");

  // ── Brand two: handoff 1l. Two-column layout (reassurance left, form right),
  // reusing the working ContactForm (ink submit). The handoff's unconfirmed
  // response-time / support-email block is deliberately omitted — ship neither
  // until confirmed. Warm single-column layout kept below. ─────────────────────
  if (resolveBrand() === "two") {
    const reassurance = [
      { Icon: Mail, title: t("r1Title"), body: t("r1Body") },
      { Icon: Users, title: t("r2Title"), body: t("r2Body") },
      { Icon: Heart, title: t("r3Title"), body: t("r3Body") },
    ];
    return (
      <main>
        <ContentContainer>
          <div className={kit.contactGrid}>
            {/* Left column */}
            <div>
              <Eyebrow>{t("eyebrow")}</Eyebrow>
              <h1 className={kit.h1}>{t("heading")}</h1>
              <p className={kit.lede}>
                {t.rich("introFaq", {
                  faq: (chunks) => (
                    <Link href="/vaprosi" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
              <hr className={kit.hairline} />
              <div className={kit.reassureList}>
                {reassurance.map(({ Icon, title, body }) => (
                  <div key={title} className={kit.reassureItem}>
                    <Icon className={kit.reassureIcon} size={40} strokeWidth={1.6} aria-hidden="true" />
                    <div>
                      <p className={kit.reassureTitle}>{title}</p>
                      <p className={kit.reassureBody}>{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right column — form card */}
            <div className={kit.formCard}>
              <ContactForm inkSubmit />
            </div>
          </div>
        </ContentContainer>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-12) 0 var(--space-16)" }}>
      <ContentContainer maxWidth={480}>
        <h1 style={{ font: "var(--text-display-md)", margin: "0 0 var(--space-2)" }}>{t("heading")}</h1>
        <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          {t("intro")}
        </p>
        <ContactForm />
      </ContentContainer>
    </main>
  );
}

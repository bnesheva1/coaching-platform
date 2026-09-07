import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { ConfirmEmailForm } from "./ConfirmEmailForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("confirmEmailTitle"), description: t("confirmEmailMetaDescription") };
}

// No server-side session check here — same reasoning as
// reset-password/page.tsx: the confirmation token arrives in the URL
// fragment, which the server never sees at all.
export default function ConfirmEmailPage() {
  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <ConfirmEmailForm />
      </ContentContainer>
    </main>
  );
}

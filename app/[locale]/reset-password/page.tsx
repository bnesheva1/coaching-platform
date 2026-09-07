import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("resetPasswordTitle"), description: t("resetPasswordMetaDescription") };
}

// No server-side session check here — the recovery link's token
// arrives in the URL fragment (see ResetPasswordForm's own comment on
// why), which the server never sees at all. Every bit of "is this link
// valid" logic lives client-side in the form itself.
export default function ResetPasswordPage() {
  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <ResetPasswordForm />
      </ContentContainer>
    </main>
  );
}

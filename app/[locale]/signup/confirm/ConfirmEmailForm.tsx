"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";

type Status = "checking" | "expired";

// Mirrors ResetPasswordForm.tsx's own fragment-reading logic almost
// exactly, for the same underlying reason: admin.generateLink({ type:
// "signup" }) (used by signup/actions.ts, so delivery can go through
// this app's own Resend integration instead of Supabase's built-in
// SMTP) produces an action_link that redirects here with the session
// token in the URL FRAGMENT (#access_token=...&type=signup), not a
// ?code= query param — fragments never reach the server, so this can't
// be handled by /auth/callback the way a PKCE flow would be.
export function ConfirmEmailForm() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const supabase = createClient();

    async function confirm() {
      const hash = window.location.hash;
      if (hash.includes("access_token") && hash.includes("type=signup")) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          // Stripped regardless of outcome — same reasoning as
          // ResetPasswordForm.tsx: this URL can end up in browser
          // history/autocomplete, and the token has no reason to still
          // be visible there once it's been used (or failed) once.
          window.history.replaceState(null, "", window.location.pathname);
          if (!error && data.session) {
            const role = data.session.user.user_metadata?.role;
            router.replace(role === "practitioner" ? "/practitioner-dashboard" : "/client-dashboard");
            return;
          }
        }
      }
      setStatus("expired");
    }

    confirm();
  }, [router]);

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("confirmEmailTitle")}</h1>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          {t("verifyingConfirmLink")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("confirmLinkExpiredTitle")}</h1>
      <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
        {t("confirmLinkExpiredBody")}
      </p>
      <Button href="/login">{t("loginTitle")}</Button>
      <p style={{ margin: 0 }}>
        <Link href="/signup" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
          {t("signupTitle")}
        </Link>
      </p>
    </div>
  );
}

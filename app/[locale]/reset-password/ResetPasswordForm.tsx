"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { resetPassword, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

type LinkStatus = "checking" | "ready" | "expired";

// admin.generateLink()'s recovery links (used by requestPasswordReset,
// since it deliberately bypasses Supabase's own resetPasswordForEmail
// to route delivery through Resend — see that file's comment) redirect
// with the session token in the URL FRAGMENT
// (#access_token=...&refresh_token=...&type=recovery), not a ?code=
// query param — fragments never reach the server at all, so this can't
// be handled server-side the way this app's /auth/callback route
// handles every other auth flow. This component reads the fragment
// itself and calls the browser client's setSession() directly.
export function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(resetPassword, initialState);
  const [status, setStatus] = useState<LinkStatus>("checking");

  useEffect(() => {
    const supabase = createClient();

    async function establishSession() {
      const hash = window.location.hash;
      if (hash.includes("access_token") && hash.includes("type=recovery")) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          // Stripped immediately regardless of outcome — this URL can
          // end up in browser history/autocomplete, and the token has
          // no reason to still be visible there once it's been used
          // (or failed) once.
          window.history.replaceState(null, "", window.location.pathname);
          if (!error) {
            setStatus("ready");
            return;
          }
        }
      }

      // No usable fragment — e.g. a page refresh after it was already
      // consumed once, or the link was tampered with. Fall back to
      // whatever session (if any) already exists.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setStatus(user ? "ready" : "expired");
    }

    establishSession();
  }, []);

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("resetPasswordTitle")}</h1>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          {t("verifyingResetLink")}
        </p>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("resetLinkExpiredTitle")}</h1>
        <p style={{ margin: 0, font: "var(--text-body-md)", color: "var(--text-secondary)" }}>
          {t("resetLinkExpiredBody")}
        </p>
        <Button href="/forgot-password">{t("requestNewLinkButton")}</Button>
      </div>
    );
  }

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h1 style={{ font: "var(--text-heading-lg)", margin: 0 }}>{t("resetPasswordTitle")}</h1>
      <label>
        {t("newPasswordLabel")}
        <input name="password" type="password" required minLength={12} className="form-field" style={{ width: "100%" }} />
      </label>
      <p style={{ font: "var(--text-body-sm)", color: "var(--text-tertiary)", margin: "calc(-1 * var(--space-2)) 0 0" }}>
        {t("passwordHint")}
      </p>
      <label>
        {t("confirmPasswordLabel")}
        <input name="confirmPassword" type="password" required minLength={12} className="form-field" style={{ width: "100%" }} />
      </label>
      {state?.error && <p style={{ color: "var(--color-danger)" }}>{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("resetPasswordButtonPending") : t("resetPasswordButton")}
      </Button>
      <p style={{ margin: 0 }}>
        <Link href="/login" style={{ font: "var(--text-body-sm)", color: "var(--accent)" }}>
          {t("loginTitle")}
        </Link>
      </p>
    </form>
  );
}

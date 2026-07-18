"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ContentContainer } from "@/components/ui/ContentContainer";
import { Button } from "@/components/ui/Button";
import { login, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function LoginForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main style={{ padding: "var(--space-16) 0" }}>
      <ContentContainer maxWidth={400}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <h1 style={{ font: "var(--text-heading-lg)" }}>{t("loginTitle")}</h1>
          <form
            action={formAction}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
          >
            <label>
              {t("emailLabel")}
              <input name="email" type="email" required className="form-field" style={{ width: "100%" }} />
            </label>
            <label>
              {t("passwordLabel")}
              <input name="password" type="password" required className="form-field" style={{ width: "100%" }} />
            </label>
            {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? t("loginButtonPending") : t("loginButton")}
            </Button>
          </form>
          <p>
            {t.rich("noAccountPrompt", {
              signup: (chunks) => <Link href="/signup">{chunks}</Link>,
            })}
          </p>
        </div>
      </ContentContainer>
    </main>
  );
}

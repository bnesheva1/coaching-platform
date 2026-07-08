"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { login, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function LoginForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main
      style={{
        maxWidth: 400,
        margin: "4rem auto",
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <h1>{t("loginTitle")}</h1>
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          {t("emailLabel")}
          <input name="email" type="email" required />
        </label>
        <label>
          {t("passwordLabel")}
          <input name="password" type="password" required />
        </label>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t("loginButtonPending") : t("loginButton")}
        </button>
      </form>
      <p>
        {t.rich("noAccountPrompt", {
          signup: (chunks) => <Link href="/signup">{chunks}</Link>,
        })}
      </p>
    </main>
  );
}

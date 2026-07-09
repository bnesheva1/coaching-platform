"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Turnstile } from "@marsidev/react-turnstile";
import { Link } from "@/i18n/navigation";
import { signup, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function SignupForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(signup, initialState);

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
      <h1>{t("signupTitle")}</h1>
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          {t("displayNameLabel")}
          <input name="displayName" type="text" required />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          {t("displayNameHint")}
        </p>
        <label>
          {t("emailLabel")}
          <input name="email" type="email" required />
        </label>
        <label>
          {t("passwordLabel")}
          <input name="password" type="password" required minLength={12} />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          {t("passwordHint")}
        </p>
        <fieldset>
          <legend>{t("roleLegend")}</legend>
          <label>
            <input type="radio" name="role" value="client" defaultChecked />{" "}
            {t("roleClient")}
          </label>
          <br />
          <label>
            <input type="radio" name="role" value="practitioner" />{" "}
            {t("rolePractitioner")}
          </label>
        </fieldset>
        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
          <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
        )}
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t("signupButtonPending") : t("signupButton")}
        </button>
      </form>
      <p>
        {t.rich("hasAccountPrompt", {
          login: (chunks) => <Link href="/login">{chunks}</Link>,
        })}
      </p>
    </main>
  );
}

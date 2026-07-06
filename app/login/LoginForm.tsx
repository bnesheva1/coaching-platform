"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function LoginForm() {
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
      <h1>Log in</h1>
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p>
        Don&apos;t have an account? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}

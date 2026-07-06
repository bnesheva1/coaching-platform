"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export default function SignupPage() {
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
      <h1>Sign up</h1>
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          Full name
          <input name="fullName" type="text" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required minLength={6} />
        </label>
        <fieldset>
          <legend>I am a…</legend>
          <label>
            <input type="radio" name="role" value="client" defaultChecked />{" "}
            Client
          </label>
          <br />
          <label>
            <input type="radio" name="role" value="practitioner" />{" "}
            Practitioner
          </label>
        </fieldset>
        {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}

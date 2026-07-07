"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { signup, checkUsernameAvailability, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

// Only the last *completed* check result is stored in state. "Checking"
// isn't a stored status — it's derived by comparing the current username
// against what that result was for, so the only setState call happens
// asynchronously once the debounced check actually resolves, never
// synchronously within the effect body itself.
type CheckResult = { username: string; available: boolean; reason?: string };

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, initialState);
  const [username, setUsername] = useState("");
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (!username) {
      return;
    }

    const timeout = setTimeout(async () => {
      const result = await checkUsernameAvailability(username);
      setLastResult({
        username,
        available: result.available,
        reason: result.available ? undefined : result.reason,
      });
    }, 400);

    return () => clearTimeout(timeout);
  }, [username]);

  const isChecking = username.length > 0 && lastResult?.username !== username;
  const isAvailable = lastResult?.username === username && lastResult.available;
  const unavailableReason =
    lastResult?.username === username && !lastResult.available
      ? lastResult.reason
      : undefined;

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
          Username
          <input
            name="username"
            type="text"
            required
            minLength={3}
            pattern="[a-z0-9_\-]+"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          This is your ASCII URL handle — lowercase letters, numbers, hyphens,
          and underscores only. It will be part of your public profile URL.
        </p>
        {isChecking && (
          <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
            Checking availability…
          </p>
        )}
        {isAvailable && (
          <p style={{ fontSize: "0.85rem", color: "green", marginTop: "-0.5rem" }}>
            ✓ Available
          </p>
        )}
        {unavailableReason && (
          <p style={{ fontSize: "0.85rem", color: "crimson", marginTop: "-0.5rem" }}>
            {unavailableReason}
          </p>
        )}
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required minLength={12} />
        </label>
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
          Must be at least 12 characters.
        </p>
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

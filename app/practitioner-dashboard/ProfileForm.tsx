"use client";

import { useActionState, useEffect, useState } from "react";
import { saveProfile, checkUsernameAvailability, type ProfileFormState } from "./actions";

const SPECIALTY_OPTIONS = ["tarot", "astrology", "reiki", "coaching"];

const initialState: ProfileFormState = null;

// Same pattern as the old signup-form live check: only the last
// *completed* check result is stored, "checking" is derived by comparing
// the current input against what that result was for. Also skips the
// check entirely when the field still matches what's already saved, so
// opening the page doesn't immediately re-check your own username.
type CheckResult = { username: string; available: boolean; reason?: string };

export function ProfileForm({
  initialUsername,
  initialDisplayName,
  initialBio,
  initialSpecialties,
  initialAvatarUrl,
}: {
  initialUsername: string | null;
  initialDisplayName: string;
  initialBio: string;
  initialSpecialties: string[];
  initialAvatarUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveProfile, initialState);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (!username || username === initialUsername) {
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
  }, [username, initialUsername]);

  const isChecking =
    username.length > 0 && username !== initialUsername && lastResult?.username !== username;
  const isAvailable = lastResult?.username === username && lastResult.available;
  const unavailableReason =
    lastResult?.username === username && !lastResult.available
      ? lastResult.reason
      : undefined;

  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: 400,
      }}
    >
      <label>
        Username
        <br />
        <input
          name="username"
          type="text"
          minLength={3}
          pattern="[a-z0-9_\-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
        Your ASCII URL handle — lowercase letters, numbers, hyphens, and
        underscores only. Required before your profile can be found
        publicly.
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
        Display name
        <br />
        <input
          name="displayName"
          type="text"
          defaultValue={initialDisplayName}
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "-0.5rem" }}>
        The public name shown on your profile — any language or script is
        fine (unlike your username above, which is ASCII-only).
      </p>

      <label>
        Bio
        <br />
        <textarea
          name="bio"
          rows={5}
          defaultValue={initialBio}
          style={{ width: "100%" }}
        />
      </label>

      <fieldset>
        <legend>Specialties</legend>
        {SPECIALTY_OPTIONS.map((specialty) => (
          <label key={specialty} style={{ display: "block" }}>
            <input
              type="checkbox"
              name="specialties"
              value={specialty}
              defaultChecked={initialSpecialties.includes(specialty)}
            />{" "}
            {specialty}
          </label>
        ))}
      </fieldset>

      <label>
        Profile photo
        <br />
        {initialAvatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={initialAvatarUrl}
            alt="Current profile"
            style={{
              width: 100,
              height: 100,
              objectFit: "cover",
              borderRadius: "50%",
              display: "block",
              marginBottom: "0.5rem",
            }}
          />
        )}
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" />
      </label>

      {state?.error && <p style={{ color: "crimson" }}>{state.error}</p>}
      {state?.success && <p style={{ color: "green" }}>Saved!</p>}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

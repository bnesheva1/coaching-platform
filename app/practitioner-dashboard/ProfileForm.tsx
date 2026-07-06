"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "./actions";

const SPECIALTY_OPTIONS = ["tarot", "astrology", "reiki", "coaching"];

const initialState: ProfileFormState = null;

export function ProfileForm({
  initialBio,
  initialSpecialties,
  initialAvatarUrl,
}: {
  initialBio: string;
  initialSpecialties: string[];
  initialAvatarUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveProfile, initialState);

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

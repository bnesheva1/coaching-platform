"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/Button";
import { toggleSavePractitioner } from "@/lib/practitioners/save-actions";

// The save/favourite toggle, shared by the public profile ("full" — a labelled
// button) and the browse/dashboard cards ("compact" — an icon-only affordance in
// the card corner). Saving and unsaving are the same control; the filled heart +
// aria-pressed make the current state obvious at a glance. Optimistic, reverting
// on failure. A logged-out visitor is sent to log in and returned to the
// practitioner afterwards (no local stashing — the login prompt is honest about
// what's needed).
export function SaveButton({
  practitionerId,
  username,
  initialSaved,
  viewerIsGuest,
  variant = "full",
  onToggle,
}: {
  practitionerId: string;
  username: string;
  initialSaved: boolean;
  viewerIsGuest: boolean;
  variant?: "full" | "compact";
  // Called with the new saved state after a toggle (used by the saved-list grid
  // to remove a card the moment it's unsaved).
  onToggle?: (saved: boolean) => void;
}) {
  const t = useTranslations("Saved");
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    // The compact button lives inside a card that is itself a link — don't let the
    // click bubble into a navigation.
    e.preventDefault();
    e.stopPropagation();

    if (viewerIsGuest) {
      router.push(`/login?next=${encodeURIComponent(`/p/${username}`)}`);
      return;
    }

    const next = !saved;
    setSaved(next); // optimistic
    onToggle?.(next);
    startTransition(async () => {
      const res = await toggleSavePractitioner(practitionerId);
      if (!res.ok) {
        setSaved(!next); // revert
        onToggle?.(!next);
      } else if (res.saved !== next) {
        // Reconcile with the server's truth (e.g. a double-click race).
        setSaved(res.saved);
        onToggle?.(res.saved);
      }
    });
  }

  const heart = <Heart size={variant === "full" ? 16 : 17} fill={saved ? "var(--accent)" : "none"} color="var(--accent)" aria-hidden="true" />;

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? t("unsaveAria") : t("saveAria")}
        className="focus-ring"
        style={{
          position: "absolute",
          top: "var(--space-3)",
          left: "var(--space-3)",
          width: 34,
          height: 34,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 1px 3px hsl(var(--shadow-color) / .12)",
          cursor: pending ? "default" : "pointer",
          touchAction: "manipulation",
          zIndex: 1,
        }}
      >
        {heart}
      </button>
    );
  }

  return (
    <Button variant={saved ? "secondary" : "surface"} size="lg" onClick={handleClick} disabled={pending} aria-pressed={saved}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {heart}
        {saved ? t("saved") : t("save")}
      </span>
    </Button>
  );
}

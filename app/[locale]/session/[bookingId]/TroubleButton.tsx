"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import styles from "./session.module.css";

// The "having trouble connecting?" affordance. Client-only — the reveal
// RPC is scoped to the booking's client, so SessionRoom only renders this
// for callerRole === "client". POSTs to the emergency-contact route, which
// logs the reveal, notifies the practitioner, and flips the session to
// manual review. Copy on success is deliberately reassuring, not alarming.
export function TroubleButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("Session");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "revealed" | "unavailable">("idle");
  const [contact, setContact] = useState<string | null>(null);

  async function reveal() {
    setState("loading");
    try {
      const res = await fetch(`/api/video/${bookingId}/emergency-contact`, { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { contact: string };
        setContact(body.contact);
        setState("revealed");
      } else {
        setState("unavailable");
      }
    } catch {
      setState("unavailable");
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.troubleLink} onClick={() => setOpen(true)}>
        {t("troubleButton")}
      </button>
    );
  }

  function close() {
    setOpen(false);
    setState("idle");
    setContact(null);
  }

  return (
    <div className={styles.troubleModal} role="dialog" aria-modal="true">
      <div className={styles.troublePanel}>
        {state === "idle" && (
          <>
            <p className={styles.subtle}>{t("troubleIntro")}</p>
            <Button variant="primary" fullWidth onClick={reveal}>
              {t("troubleReveal")}
            </Button>
            <button type="button" className={styles.troubleLink} onClick={close}>
              {t("close")}
            </button>
          </>
        )}
        {state === "loading" && <p className={styles.subtle}>{t("troubleLoading")}</p>}
        {state === "revealed" && (
          <>
            <p className={styles.subtle}>{t("troubleRevealedIntro")}</p>
            <p className={styles.contactValue}>{contact}</p>
            {/* Reassuring, not alarming — a client whose video just failed
                shouldn't feel they triggered an investigation. */}
            <p className={styles.subtle}>{t("troubleRevealedNote")}</p>
            <button type="button" className={styles.troubleLink} onClick={close}>
              {t("close")}
            </button>
          </>
        )}
        {state === "unavailable" && (
          <>
            <p className={styles.subtle}>{t("troubleUnavailable")}</p>
            <button type="button" className={styles.troubleLink} onClick={close}>
              {t("close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

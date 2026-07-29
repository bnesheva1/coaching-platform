"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

// Used by NavBar's mobile menu drawer — dismiss on outside click or
// Escape. Kept as its own hook (not inlined) since this is the same
// "open, dismiss on outside interaction" contract any future popover/
// drawer in this app would also need.
export function useClickOutsideAndEscape(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;

    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, ref, onClose]);
}

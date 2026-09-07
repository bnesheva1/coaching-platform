import { useEffect, useRef } from "react";

// Focus management for a hand-rolled (non-native-<dialog>) modal: when `active`
// turns true it moves focus into `ref`, keeps Tab/Shift+Tab cycling within it,
// closes on Escape (via `onClose`), and restores focus to whatever was focused
// before on close. Native <dialog>.showModal() gives all of this for free; this
// is for the two modals built as plain divs (TroubleButton, AvailabilityWidget's
// block dialog) that we don't want to restructure visually.
//
// The container should have tabIndex={-1} so it can receive focus as a fallback
// when it holds no focusable children yet.
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose?: () => void,
) {
  // Keep the latest onClose without making it an effect dependency, so the trap
  // isn't torn down and re-armed (which would re-steal focus) on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null);

    (focusable()[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}

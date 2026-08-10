"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

let bodyScrollLockCount = 0;
let bodyOverflowBeforeFirstDialog = "";

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeFirstDialog = document.body.style.overflow;
  }
  bodyScrollLockCount += 1;
  document.body.style.overflow = "hidden";

  return () => {
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeFirstDialog;
    }
  };
}

export function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => (
      !element.closest("[hidden], [aria-hidden='true'], [inert]")
      && (!element.closest("details:not([open])") || element.tagName === "SUMMARY")
    ));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useDialogLifecycle({
  enabled = true,
  initialFocusRef,
  restoreFocusRef,
  onClose,
  canCloseOnEscape,
}: {
  enabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  canCloseOnEscape?: () => boolean;
}) {
  const onCloseRef = useRef(onClose);
  const canCloseOnEscapeRef = useRef(canCloseOnEscape);
  onCloseRef.current = onClose;
  canCloseOnEscapeRef.current = canCloseOnEscape;

  useEffect(() => {
    if (!enabled) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const restoreFocusTarget = restoreFocusRef?.current ?? previousFocus;
    const unlockBodyScroll = lockBodyScroll();
    initialFocusRef?.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape"
        && !event.defaultPrevented
        && (canCloseOnEscapeRef.current?.() ?? true)
      ) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      unlockBodyScroll();
      if (restoreFocusTarget?.isConnected) restoreFocusTarget.focus();
    };
  }, [enabled, initialFocusRef, restoreFocusRef]);
}

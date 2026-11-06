import { type MouseEvent, type RefObject, useEffect, useId, useRef, useState } from "react";

/** The keyboard and pointer behaviour every Modal and Drawer shares:
 * - focus moves into the dialog when it opens (a field asking for autoFocus, else its first form
 *   field, else the dialog box itself) and goes back to whatever opened it when it closes;
 * - Tab / Shift+Tab cycle inside it;
 * - Esc closes only the top-most dialog - the one holding focus - so a picker opened from a
 *   drawer closes alone;
 * - the overlay closes it only for a click that also *started* on the overlay, so a text
 *   selection dragged out of a field doesn't close it;
 * - each dialog sits above the ones opened before it, wherever it is in the page. */

/** Open dialogs' boxes, oldest first. Answers "which dialog is on top" when focus is outside them all. */
const openDialogs: HTMLElement[] = [];

/** z-index of the first dialog; each one opened on top of it adds one. */
const BASE_Z_INDEX = 100;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** What Tab can reach inside the box, skipping anything not shown (e.g. print-only content). */
function focusables(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.checkVisibility?.() ?? true);
}

/** The dialog a key press belongs to: the innermost open one holding focus, else the last opened.
 * (A dialog nested inside another mounts first - React runs a child's effects before its
 * parent's - so open order alone can't say which is on top.) */
function topDialog(target: EventTarget | null): HTMLElement | undefined {
  const holder = target instanceof Element ? target.closest<HTMLElement>("[role='dialog']") : null;
  if (holder && openDialogs.includes(holder)) return holder;
  return openDialogs[openDialogs.length - 1];
}

export function useDialogA11y(boxRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const titleId = useId();
  const [zIndex] = useState(() => BASE_Z_INDEX + openDialogs.length);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    openDialogs.push(box);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A field rendered with autoFocus has already taken focus by now; otherwise pick one.
    if (!box.contains(document.activeElement)) {
      const firstField = box.querySelector<HTMLElement>(
        "input:not([disabled]):not([type='hidden']):not([type='checkbox']):not([type='radio']), select:not([disabled]), textarea:not([disabled])",
      );
      (firstField ?? box).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!box || topDialog(e.target) !== box) return;
      if (e.key === "Escape") {
        // A field inside that used Esc for itself (cancel an inline edit) marks it handled.
        if (e.defaultPrevented) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(box);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === box || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openDialogs.splice(openDialogs.indexOf(box), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [boxRef]);

  const pressStartedOnOverlay = useRef(false);
  const overlayProps = {
    style: { zIndex },
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressStartedOnOverlay.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (pressStartedOnOverlay.current && e.target === e.currentTarget) onCloseRef.current();
      pressStartedOnOverlay.current = false;
    },
  };

  /** Spread onto the dialog box (the element `boxRef` points at). */
  const boxProps = {
    role: "dialog" as const,
    "aria-modal": true,
    tabIndex: -1,
  };

  return { titleId, overlayProps, boxProps };
}

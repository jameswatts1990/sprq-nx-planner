import { createContext, useCallback, useEffect, useRef, useState } from "react";

import type { CellLinkTarget } from "./cellLinkState";

/** How long the pointer must rest on a slot before the hover preview appears - long enough
 * that briefly passing over slots while scanning the grid doesn't flash the highlight. */
const HOVER_DELAY_MS = 1500;

export interface CellLinkContextValue {
  /** The hover/pin target currently in effect, or null. A pin wins over a stale hover so
   * moving the mouse away from a pinned cell doesn't clear the highlight. */
  active: CellLinkTarget | null;
  setHover: (target: CellLinkTarget) => void;
  clearHover: () => void;
  /** Shift+click (or Shift+Enter) on a slot: pins it, switches the pin to a different
   * cell, or un-pins if the same cell is targeted again. */
  togglePin: (target: CellLinkTarget) => void;
}

const INERT_CONTEXT: CellLinkContextValue = {
  active: null,
  setHover: () => {},
  clearHover: () => {},
  togglePin: () => {},
};

/** Consumed via useContext in SchedulerSlot. Defaults to a no-op value so any render tree
 * outside SchedulePage's provider degrades to "no highlight" instead of throwing. */
export const CellLinkContext = createContext<CellLinkContextValue>(INERT_CONTEXT);

/** Marks a slot's DOM node as participating in cell-link pinning - present only on filled
 * slots (set directly in SchedulerSlotView), consulted by the click-outside handler below. */
export const CELL_LINK_SLOT_ATTR = "data-cell-link-slot";

function sameTarget(a: CellLinkTarget | null, b: CellLinkTarget): boolean {
  return a !== null && a.cellId === b.cellId && a.sourceUseId === b.sourceUseId;
}

/**
 * Owns hover/pin state for the cross-time "same cell" highlight (see cellLinkState.ts).
 * Resting the pointer on a filled slot for HOVER_DELAY_MS previews the link (moving on
 * before then cancels it, so scanning across the grid doesn't flash highlights); Shift+
 * click "pins" it immediately, with no delay, so the user can move the mouse elsewhere
 * without losing the highlight, cleared by Escape or by clicking anywhere that isn't a
 * participating slot. Clicking a *different* slot re-targets or toggles the pin via
 * togglePin instead, so the outside-click check only has to catch genuinely unrelated
 * clicks (see CELL_LINK_SLOT_ATTR) - this sidesteps any ordering ambiguity between the
 * click that sets a pin and a naively-attached "outside click" listener.
 *
 * Entirely suppressed while `suppressed` is true (wired to drag-in-progress in
 * SchedulePage) so it never fights the drag/drop visuals.
 */
export function useCellLinkHighlight(suppressed: boolean): CellLinkContextValue {
  const [hovered, setHovered] = useState<CellLinkTarget | null>(null);
  const [pinned, setPinned] = useState<CellLinkTarget | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);
  // Cancel any pending hover timeout on unmount, and drop an in-progress hover the moment
  // a drag starts (rather than letting a timeout scheduled just before it fires anyway).
  useEffect(() => {
    if (suppressed) {
      cancelHoverTimeout();
      setHovered(null);
    }
    return cancelHoverTimeout;
  }, [suppressed, cancelHoverTimeout]);

  const setHover = useCallback(
    (target: CellLinkTarget) => {
      cancelHoverTimeout();
      if (suppressed) return;
      hoverTimeoutRef.current = setTimeout(() => {
        hoverTimeoutRef.current = null;
        setHovered(target);
      }, HOVER_DELAY_MS);
    },
    [suppressed, cancelHoverTimeout],
  );
  const clearHover = useCallback(() => {
    cancelHoverTimeout();
    setHovered(null);
  }, [cancelHoverTimeout]);
  const togglePin = useCallback(
    (target: CellLinkTarget) => {
      if (suppressed) return;
      setPinned((prev) => (sameTarget(prev, target) ? null : target));
    },
    [suppressed],
  );

  useEffect(() => {
    if (!pinned) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPinned(null);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`[${CELL_LINK_SLOT_ATTR}]`)) return;
      setPinned(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pinned]);

  if (suppressed) return INERT_CONTEXT;
  return { active: pinned ?? hovered, setHover, clearHover, togglePin };
}

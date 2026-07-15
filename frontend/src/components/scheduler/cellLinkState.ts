import type { StageOut } from "@/types/schedule";

/** Identifies which specific cell load a hover/pin targets - the physical cell, plus the
 * exact cell_use (occurrence) that triggered it, so the slot that was actually hovered/
 * pinned can render differently from the same cell's *other* uses elsewhere in the grid. */
export interface CellLinkTarget {
  cellId: number;
  sourceUseId: number;
}

export interface CellLinkState {
  /** This is the exact slot being hovered/pinned. */
  isSource: boolean;
  /** A different slot sharing the same cell_id as the active target. */
  isPeer: boolean;
  /** Something is active, and this slot is neither the source nor a peer. */
  isDimmed: boolean;
}

const INERT: CellLinkState = { isSource: false, isPeer: false, isDimmed: false };

/**
 * Pure derivation of how `stage` should render given the currently active hover/pin
 * target (or null when nothing is active). Kept UI-free so it's unit-testable directly.
 */
export function deriveLinkState(active: CellLinkTarget | null, stage: StageOut | null): CellLinkState {
  if (!active || !stage) return INERT;
  if (stage.cell_id !== active.cellId) return { isSource: false, isPeer: false, isDimmed: true };
  if (stage.cell_use_id === active.sourceUseId) return { isSource: true, isPeer: false, isDimmed: false };
  return { isSource: false, isPeer: true, isDimmed: false };
}

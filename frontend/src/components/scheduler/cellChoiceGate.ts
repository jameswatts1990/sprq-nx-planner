export interface CellChoiceGateInput {
  /** Dragging an already-placed sample. */
  isMove: boolean;
  /** Only meaningful when isMove: the dragged cell is pinned (by another of its own uses)
   * to a well other than the drop target - it can't go there itself, so the sample needs
   * a different cell, resolved exactly like a fresh placement. False for a same-well
   * reschedule or a cell with no other uses yet - those keep the same cell with no
   * decision to make. */
  wellConflict: boolean;
  /** The (instrument, day) has no Cycle yet - the only case a pure move (no cell
   * decision) ever needs the modal for. */
  isNewRun: boolean;
  cellsLoading: boolean;
  cellsError: boolean;
  compatibleCount: number;
  /** The drop landed on a still-valid waiting-cell ghost, so the cell choice is already made. */
  preselectedValid: boolean;
}

/** True whenever this placement/move actually has a cell to resolve - a fresh placement
 * always does; a move only does when the dragged cell can't take the destination well. */
function needsCellChoice(input: Pick<CellChoiceGateInput, "isMove" | "wellConflict">): boolean {
  return !input.isMove || input.wellConflict;
}

/** Whether there's a real decision (or error) to surface - shared by both the
 * modal-visibility gate and the auto-place effect below, since they must never disagree
 * about what counts as "unambiguous". */
function hasUnresolvedPlacementChoice(input: CellChoiceGateInput): boolean {
  return needsCellChoice(input) && (input.cellsError || (input.compatibleCount > 0 && !input.preselectedValid));
}

/** A pure move (same cell, no decision to make) into a brand-new run has no auto-place
 * path at all (no cell choice to resolve, and nowhere else to collect a start time) -
 * that's the only case isNewRun alone should force the popup. Otherwise the popup is only
 * for genuine ambiguity or a failed mutation. */
export function shouldShowCellChoiceModal(input: CellChoiceGateInput & { mutationError: boolean }): boolean {
  return (!needsCellChoice(input) && input.isNewRun) || hasUnresolvedPlacementChoice(input) || input.mutationError;
}

/** Whether it's safe to silently confirm the placement/move without ever showing the
 * modal - a ghost-drop or forced-new-cell case, even into a brand-new run. */
export function shouldAutoPlace(input: CellChoiceGateInput): boolean {
  if (!needsCellChoice(input) && input.isNewRun) return false;
  if (needsCellChoice(input) && input.cellsLoading) return false;
  if (hasUnresolvedPlacementChoice(input)) return false;
  return true;
}

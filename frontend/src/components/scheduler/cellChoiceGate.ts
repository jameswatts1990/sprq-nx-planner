export interface CellChoiceGateInput {
  /** Dragging an already-placed sample - never has a cell decision to make. */
  isMove: boolean;
  /** The (instrument, day) has no Cycle yet - the only case a move ever needs the modal for. */
  isNewRun: boolean;
  cellsLoading: boolean;
  cellsError: boolean;
  compatibleCount: number;
  /** The drop landed on a still-valid waiting-cell ghost, so the cell choice is already made. */
  preselectedValid: boolean;
}

/** Whether there's a real decision (or error) to surface for a non-move placement -
 * shared by both the modal-visibility gate and the auto-place effect below, since they
 * must never disagree about what counts as "unambiguous". */
function hasUnresolvedPlacementChoice(input: CellChoiceGateInput): boolean {
  return !input.isMove && (input.cellsError || (input.compatibleCount > 0 && !input.preselectedValid));
}

/** A move into a brand-new run has no auto-place path at all (no cell choice to resolve,
 * and nowhere else to collect a start time) - that's the only case isNewRun alone should
 * force the popup. Otherwise the popup is only for genuine ambiguity or a failed mutation. */
export function shouldShowCellChoiceModal(input: CellChoiceGateInput & { mutationError: boolean }): boolean {
  return (input.isMove && input.isNewRun) || hasUnresolvedPlacementChoice(input) || input.mutationError;
}

/** Whether it's safe to silently confirm the placement/move without ever showing the
 * modal - a ghost-drop or forced-new-cell case, even into a brand-new run. */
export function shouldAutoPlace(input: CellChoiceGateInput): boolean {
  if (input.isMove && input.isNewRun) return false;
  if (!input.isMove && input.cellsLoading) return false;
  if (hasUnresolvedPlacementChoice(input)) return false;
  return true;
}

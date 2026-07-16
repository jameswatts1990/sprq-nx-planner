/** Mirrors backend/app/engine/constants.py's CELL_LIFETIME_H - the single 108h deadline
 * from a cell's own Use 1, not a per-use or per-tray timer (see
 * docs/pacbio-sprq-nx-scheduling-reference.md #2). Shared by every frontend surface that
 * needs to shade/fade something by how close a cell is to this deadline: waiting-cell
 * ghosts (waitingCells.ts) and the grid slot's own expiry shading (SchedulerSlotView.tsx). */
export const CELL_LIFETIME_H = 108;

/** Opacity is ~1.0 (dark/full colour) far from the deadline, fading toward
 * FADE_MIN_OPACITY (light/washed-out) as it nears the cutoff. Full/near-1.0 at/above
 * FADE_FULL_HOURS-to-go; FADE_MIN_OPACITY at/below FADE_MIN_HOURS-to-go. Tuned for a 108h
 * window run on weekdays only, so the fade has room to show across 2-3 calendar days. */
export const FADE_FULL_HOURS = 90;
export const FADE_MIN_HOURS = 18;
export const FADE_MIN_OPACITY = 0.4;

/** Opacity for a cell that has `hoursElapsed` hours into its own 108h window - dark when
 * just started, fading toward FADE_MIN_OPACITY as hoursElapsed approaches CELL_LIFETIME_H,
 * clamped at FADE_MIN_OPACITY once overdue. Shared fade curve for both "hours already
 * elapsed" (grid slot shading) and "hours until a reuse deadline" (waiting-cell ghosts) -
 * callers pass whichever quantity is relevant, both fade the same way. */
export function expiryFadeOpacity(hoursRemaining: number): number {
  const clamped = Math.min(FADE_FULL_HOURS, Math.max(FADE_MIN_HOURS, hoursRemaining));
  return FADE_MIN_OPACITY + ((clamped - FADE_MIN_HOURS) / (FADE_FULL_HOURS - FADE_MIN_HOURS)) * (1 - FADE_MIN_OPACITY);
}

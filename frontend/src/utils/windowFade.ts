/** Mirrors backend/app/engine/constants.py's CELL_LIFETIME_H - the single 108h deadline
 * from a cell's own Use 1, not a per-use or per-tray timer (see
 * docs/pacbio-sprq-nx-scheduling-reference.md #2). Shared by every frontend surface that
 * needs a cell's deadline: the grid slot's expiry shading (SchedulerSlotView.tsx), the tray
 * panel (instrumentTrayMaps.ts) and the cell pages. */
export const CELL_LIFETIME_H = 108;

/** Opacity is ~1.0 (dark/full colour) far from the deadline, fading toward
 * FADE_MIN_OPACITY (light/washed-out) as it nears the cutoff. Full/near-1.0 at/above
 * FADE_FULL_HOURS-to-go; FADE_MIN_OPACITY at/below FADE_MIN_HOURS-to-go. Tuned for a 108h
 * window run on weekdays only, so the fade has room to show across 2-3 calendar days. */
export const FADE_FULL_HOURS = 90;
/** Hours left on a cell's 108h window at/below which every surface warns the window is closing,
 *  in amber: the cell ring, the instrument tray map, tray summaries and Autoschedule's reuse
 *  list. One threshold and one tone everywhere - only a window that has actually closed is red.
 *  A display choice, not a scheduling rule (the 108h deadline itself is CELL_LIFETIME_H). */
export const EXPIRY_WARN_HOURS = 18;
/** The grid slot fade bottoms out where the warning starts. */
export const FADE_MIN_HOURS = EXPIRY_WARN_HOURS;
export const FADE_MIN_OPACITY = 0.4;

/** Opacity for a cell that has `hoursElapsed` hours into its own 108h window - dark when
 * just started, fading toward FADE_MIN_OPACITY as hoursElapsed approaches CELL_LIFETIME_H,
 * clamped at FADE_MIN_OPACITY once overdue. Callers pass the hours left on the window
 * (CELL_LIFETIME_H minus hours elapsed, for the grid slot shading). */
export function expiryFadeOpacity(hoursRemaining: number): number {
  const clamped = Math.min(FADE_FULL_HOURS, Math.max(FADE_MIN_HOURS, hoursRemaining));
  return FADE_MIN_OPACITY + ((clamped - FADE_MIN_HOURS) / (FADE_FULL_HOURS - FADE_MIN_HOURS)) * (1 - FADE_MIN_OPACITY);
}

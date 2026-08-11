/** Helpers for the free-text "Revio Loaded at:" time field in the Confirm-Revio-loaded
 * modal. The operator types the real load time as hh:mm (24-hour) on the lab's own (local) wall
 * clock; we validate it before letting the run lock, and parse it into the hour/minute the
 * caller converts to UTC (localWallTimeToUtcParts) before sending - the backend clock is UTC,
 * the lab clock is local. */

/** Accepts h:mm or hh:mm, 00:00-23:59. */
const LOAD_TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Format a run's planned start into the hh:mm string the field prefills with, in the viewer's
 *  LOCAL timezone (the lab wall clock) - so the prefilled value matches what the operator would
 *  read off the instrument, not a UTC-shifted time. */
export function formatLoadTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function isValidLoadTime(value: string): boolean {
  return parseLoadTime(value) !== null;
}

/** Parse an hh:mm string into { hour, minute }, or null if it isn't a valid 24-hour time. */
export function parseLoadTime(value: string): { hour: number; minute: number } | null {
  const m = LOAD_TIME_RE.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

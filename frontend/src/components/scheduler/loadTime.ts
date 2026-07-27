/** Helpers for the free-text "Revio Loaded at:" time field in the Confirm-Revio-loaded
 * modal. The operator types the real load time as hh:mm (24-hour); we validate it before
 * letting the run lock, and parse it into the hour/minute the status update expects. Times
 * are treated as UTC to match the rest of the scheduler's clock handling. */

/** Accepts h:mm or hh:mm, 00:00-23:59. */
const LOAD_TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Format a run's planned start into the hh:mm string the field prefills with. */
export function formatLoadTime(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
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

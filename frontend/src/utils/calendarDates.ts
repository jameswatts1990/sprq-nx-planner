const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Parses a `YYYY-MM-DD` string as a UTC date-only value. All day-offset arithmetic in
 * the calendar must go through UTC-based helpers so that adding `day_idx` days never
 * shifts across a local timezone boundary (which would silently move samples to the
 * wrong calendar day near midnight).
 */
export function parseDateOnly(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Adds a whole number of days (UTC) to a date-only value. */
export function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isWeekendUTC(date: Date): boolean {
  const wd = date.getUTCDay();
  return wd === 0 || wd === 6;
}

/** Serializes a UTC date-only value back to `YYYY-MM-DD` (inverse of parseDateOnly). */
export function toIsoDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today as `YYYY-MM-DD` using the local calendar date (matches the prototype's
 * convention: local calendar day, then treated as UTC midnight downstream). */
export function todayIsoUTC(): string {
  const now = new Date();
  return toIsoDateUTC(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function shortWeekdayUTC(date: Date): string {
  return DAY_SHORT[date.getUTCDay()];
}

/** Formats a UTC date-only value as e.g. "13 Jul". */
export function formatShortDateUTC(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Formats a fractional hour-of-day (e.g. 13.5) as HH:MM. */
export function formatTimeOfDay(hours: number): string {
  const hh = Math.floor(hours);
  const mm = Math.round((hours - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Formats an ISO datetime as "HH:MM, D Mon" (UTC) - used for lock_until displays. */
export function formatShortDateTimeUTC(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}, ${formatShortDateUTC(d)}`;
}

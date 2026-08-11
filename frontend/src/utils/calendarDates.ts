const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The default loading start hour (UTC), mirroring the backend's DAY_START_HOUR. Single
 * frontend source for both the reuse-window "day start" comparison (waitingCells) and the
 * radial load-time dial's default, so they can't drift apart. */
export const DAY_START_HOUR = 12;

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

/** The next Mon-Fri strictly after an ISO date (skips weekends) - where a reuse Plate 2
 * acquires, and the earliest a cell's next use can start. Mirrors the backend's
 * placement_service._next_weekday. */
export function nextWeekdayIsoUTC(isoDate: string): string {
  let d = addDaysUTC(parseDateOnly(isoDate), 1);
  while (isWeekendUTC(d)) d = addDaysUTC(d, 1);
  return toIsoDateUTC(d);
}

/** The nearest Mon-Fri on OR after an ISO date-only value (returns the date itself when it's
 * already a weekday). Contrast nextWeekdayIsoUTC, which is strictly after - used for the earliest
 * day a cell is physically free to reuse, which can be the free-time's own day. */
export function weekdayOnOrAfterIsoUTC(isoDate: string): string {
  let d = parseDateOnly(isoDate);
  while (isWeekendUTC(d)) d = addDaysUTC(d, 1);
  return toIsoDateUTC(d);
}

/** The nearest Mon-Fri strictly before an ISO date (skips weekends). */
export function prevWeekdayIsoUTC(isoDate: string): string {
  let d = addDaysUTC(parseDateOnly(isoDate), -1);
  while (isWeekendUTC(d)) d = addDaysUTC(d, -1);
  return toIsoDateUTC(d);
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

/** The Monday (UTC, date-only) of the week containing `date` - used so the scheduler's
 * week always starts on Monday regardless of what day "today" or a URL anchor falls on. */
export function mondayOfWeekUTC(date: Date): Date {
  const weekday = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDaysUTC(date, diffToMonday);
}

export function shortWeekdayUTC(date: Date): string {
  return DAY_SHORT[date.getUTCDay()];
}

/** The Friday (UTC date-only) of the Monday-based week containing `date` - the last weekday of
 * the scheduling week. Reused for the Cells page's "as of end of week" reference instant. */
export function fridayOfWeekUTC(date: Date): Date {
  return addDaysUTC(mondayOfWeekUTC(date), 4);
}

/** ISO datetime for the end of the current scheduling week - this week's Friday at 23:59:59Z.
 * The reference instant behind the Cells page's "End of week" view: how every cell's uses /
 * window / status will stand once all of this week's runs have gone. */
export function endOfWeekIso(): string {
  const friday = fridayOfWeekUTC(parseDateOnly(todayIsoUTC()));
  friday.setUTCHours(23, 59, 59, 0);
  return friday.toISOString();
}

/** Short label for this week's Friday, e.g. "Fri 31 Jul" - used in the "End of week" toggle
 * so the reference date is explicit rather than implied. */
export function endOfWeekLabel(): string {
  const friday = fridayOfWeekUTC(parseDateOnly(todayIsoUTC()));
  return `${shortWeekdayUTC(friday)} ${formatShortDateUTC(friday)}`;
}

/** Formats a UTC date-only value as e.g. "13 Jul". */
export function formatShortDateUTC(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Formats an ISO datetime as "HH:MM, D Mon" in the viewer's LOCAL timezone - used for lock_until
 * and other turnaround displays. The lab works on the instrument's own (local) wall clock, and
 * the physical Revio's lock countdown is local, so a "locked until" time must read against that
 * clock, not UTC - otherwise, in British Summer Time, the grid reads an hour behind both the
 * instrument screen's countdown and the machine in the lab. Stored/computed times stay UTC; this
 * is purely the presentation boundary, matching the browser-local `toLocaleString` the
 * History/Cells pages already use.
 */
export function formatShortDateTimeLocal(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${hh}:${mm}, ${date}`;
}

/** Formats an ISO datetime as just "HH:MM" in the viewer's LOCAL timezone - a run's load/start
 *  time against the lab wall clock. See formatShortDateTimeLocal. */
export function formatTimeLocal(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Converts an operator-picked LOCAL wall-clock load time on a calendar date to the UTC
 * hour/minute the backend stores. The backend's `start_hour`/`start_minute` contract is UTC and
 * the whole scheduling engine computes in UTC, but the lab picks load times on the instrument's
 * own (local) clock - so the picker converts here, at the boundary, and every stored time stays a
 * correct absolute instant. DST is handled automatically by the local `Date` constructor.
 *
 * NOTE: Auto Schedule sends ONE hour for a whole date range and converts using the range's
 * earliest day, so a range that straddles a DST change could place runs on the far side an hour
 * off - a rare, accepted edge (weekday loads, twice a year).
 */
export function localWallTimeToUtcParts(
  isoDate: string,
  hour: number,
  minute: number,
): { hour: number; minute: number } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const local = new Date(y, m - 1, d, hour, minute);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

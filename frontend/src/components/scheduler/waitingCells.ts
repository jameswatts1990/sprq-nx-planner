import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { addDaysUTC, isWeekendUTC, parseDateOnly, toIsoDateUTC } from "@/utils/calendarDates";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

/** Mirrors the default loading start hour used elsewhere (DAY_START_HOUR on the backend,
 * CellChoicePicker's DEFAULT_START_TIME) - used only as a representative "day start" for
 * comparing a calendar day against a cell's 108h deadline. */
const DAY_START_HOUR = 12;

export interface CellGhost {
  cell: CellOut;
  /** 1-based use number this ghost represents, e.g. 2 for "Use 2". */
  useNumber: number;
  /** The last weekday this cell's next use could still legally start before its 108h
   * window closes. Rendered as a distinct hard-line style, not just the peak of the fade. */
  isHardCutoff: boolean;
  /** ~1.0 (just became eligible, dark/full colour) fading to FADE_MIN_OPACITY (light,
   * approaching the cutoff). Meaningless when isHardCutoff is true (that variant ignores it). */
  fadeOpacity: number;
  /** The actual last calendar day this cell's next use could still start - identical
   * across every ghost rendered for this cell, so the expiry date reads the same
   * regardless of which eligible day is currently on screen. */
  cutoffDate: string;
  /** Exact deadline instant behind cutoffDate, for precise display (e.g. in a popover). */
  deadlineAt: string;
  /** True when Use 1 hasn't been confirmed loaded yet, so deadlineAt/cutoffDate are a
   * provisional estimate from its *planned* loading time, not the real 108h clock (which
   * only starts once a cell is actually removed from the tray - see
   * docs/pacbio-sprq-nx-scheduling-reference.md #2). */
  deadlineIsEstimated: boolean;
  /** True for a tray sibling that has never been used at all - it's shown so its physical
   * tray reads as fully populated, but has no 108h clock running yet (see
   * computeUnusedTraySiblingGhost), so isHardCutoff/fadeOpacity/cutoffDate/deadlineAt carry
   * no real meaning and should be ignored by anything rendering this ghost. */
  unused?: boolean;
  /** Set for a cell that has gone terminal by ordinary attrition - fully used up
   * (exhausted), timed out with capacity still unused (window_expired), or manually
   * written off (retired) - still shown in its old well as an informational marker
   * (see computeTerminalGhost). Distinct from a *stopped* cell (see SchedulerSlot's
   * `blocked` prop): stop_cell is a QC action that permanently locks its well against any
   * new placement, whereas these three are routine turnover, so the well underneath stays
   * a fully valid drop target for a brand-new tray. Mutually exclusive with `unused`;
   * isHardCutoff/fadeOpacity/deadlineAt/deadlineIsEstimated carry no meaning here. */
  terminalStatus?: Exclude<CellStatus, "open" | "stopped">;
  /** Set for a cell whose aggregate status has already flipped to exhausted/window_expired
   * because every one of its uses is fully *scheduled*, but `day` falls before the calendar
   * date it actually reaches that state (see computePendingTerminalGhost) - e.g. the cell's
   * three uses are booked for Mon/Wed/Fri and `day` is the locked Tue/Thu column in between.
   * Mutually exclusive with terminalStatus: exactly one of the two is set once the cell has
   * gone terminal, depending on whether `day` is before or on/after that boundary date. */
  pendingTerminalStatus?: Exclude<CellStatus, "open" | "stopped" | "retired">;
  /** Set when this still-open, not-fully-booked cell already has its *next* use scheduled
   * for a later day, and `day` falls before that day - e.g. a cell with 1 of 3 uses
   * consumed, next use booked for Thursday, viewed on Monday's column. Distinct from
   * pendingTerminalStatus (which only applies once every remaining use is booked and the
   * cell's aggregate status has flipped to exhausted/window_expired): this cell may still
   * have real spare capacity, just not eligible for a *new* reuse offer until its already-
   * scheduled next use has passed - so this well isn't a droppable "+" on `day` either, even
   * though it isn't fully booked yet. Without this, a well already claimed by a future,
   * not-yet-run use silently looked identical to a genuinely free slot on any earlier day. */
  pendingReuseStatus?: true;
  /** True when `day` falls before this ghost's own physical tray's founding placement (the
   * earliest planned first-use date across any cell sharing its tray_id) - see
   * computeTrayFoundingDates. The tray hasn't actually landed on the instrument as of this
   * day, even though eager population (see "Tray-of-4 eager population" above) already
   * created every sibling's Cell row up front. The ghost still carries its real data (still
   * droppable/clickable, same as any other day, and still targets this exact cell for reuse)
   * so reuse/insert-earlier-use behaviour is unchanged and the schedule stays fully flexible
   * before anything is locked in - only the rendered label/tint is suppressed in favour of a
   * plain "+", since showing "Scheduled"/"Not yet used" this early reads as if the tray were
   * already physically present, and could be misread as "this well can't take a new/earlier
   * placement" when it actually still can. */
  beforeTrayFounding?: boolean;
}

/**
 * Earliest calendar day (YYYY-MM-DD) any cell in each physical tray was actually scheduled
 * for its own first use - the day that tray genuinely became "loaded" on an instrument,
 * despite every sibling's Cell row existing from that same moment (see "Tray-of-4 eager
 * population" above). Feeds CellGhost.beforeTrayFounding. `cells` should cover every status
 * a tray-linked cell can be in (open, terminal, stopped), same as computeVacatedTrayIds, so
 * a founding cell that has since gone terminal or been stopped still anchors the date.
 * Prefers first_use_started_at (the real, confirmed anchor) over first_use_planned_start_at,
 * same precedence as computeGhost's own deadline anchor - once a use is actually confirmed
 * loaded, its planned estimate can go stale (e.g. after the placement was later moved to a
 * different day) while started_at always reflects where it really landed.
 */
export function computeTrayFoundingDates(cells: CellOut[]): Map<number, string> {
  const dates = new Map<number, string>();
  for (const cell of cells) {
    if (cell.tray_id === null) continue;
    const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
    if (!anchor) continue;
    const day = anchor.slice(0, 10);
    const existing = dates.get(cell.tray_id);
    if (!existing || day < existing) dates.set(cell.tray_id, day);
  }
  return dates;
}

function nextWeekdayAfter(isoDate: string): string {
  let d = addDaysUTC(parseDateOnly(isoDate), 1);
  while (isWeekendUTC(d)) d = addDaysUTC(d, 1);
  return toIsoDateUTC(d);
}

function prevWeekdayBefore(isoDate: string): string {
  let d = addDaysUTC(parseDateOnly(isoDate), -1);
  while (isWeekendUTC(d)) d = addDaysUTC(d, -1);
  return toIsoDateUTC(d);
}

function dayStart(isoDate: string): Date {
  const d = parseDateOnly(isoDate);
  d.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  return d;
}

/**
 * The bounds of a previously-used cell's remaining reuse window, or null when it has no
 * window to bound (never used, no first-use anchor, or the window has already been fully
 * closed off). `earliestDate` is the first weekday its next use could start (the weekday
 * after its last use); `cutoffDate` is the last weekday it could still start; `deadlineAtMs`
 * is the effective closing instant.
 *
 * Two things close the window, whichever comes first:
 *   - the cell's own 108h clock, anchored on first_use_started_at once Use 1 is confirmed
 *     loaded (falling back to first_use_planned_start_at as a provisional estimate before
 *     then - see docs/pacbio-sprq-nx-scheduling-reference.md #2); and
 *   - `evictionDate`, the day a *successor* physical tray is founded in this cell's carousel
 *     position (see computeTrayEvictionDates). A cell keeps a fixed tray/well position for
 *     life and two trays can never share one position, so once the next tray lands the whole
 *     prior tray - this cell included - has physically left the instrument and cannot be
 *     reused, even if its 108h clock hasn't run out. The last usable day is then the weekday
 *     before eviction.
 *
 * Pure function of already-fetched data - no "now" dependency, so every caller agrees on the
 * same window. Shared by computeGhost (per-day reuse ghost) and cellReuseCutoffDate (the tray
 * disposal warning's genuine last-chance day).
 */
function reuseWindow(
  cell: CellOut,
  evictionDate?: string | null,
): { earliestDate: string; cutoffDate: string; deadlineAtMs: number } | null {
  if (!cell.last_use_run_date) return null;
  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  if (!anchor) return null;
  let deadlineAtMs = new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000;
  if (evictionDate) {
    // The tray is gone from `evictionDate` on, so the last usable instant is strictly before
    // that day's start - clamp the deadline down to it if the 108h clock would run longer.
    deadlineAtMs = Math.min(deadlineAtMs, dayStart(evictionDate).getTime() - 1);
  }
  const earliestDate = nextWeekdayAfter(cell.last_use_run_date);
  if (dayStart(earliestDate).getTime() > deadlineAtMs) return null; // window shuts before any reuse day
  // Walk forward from the earliest eligible day to the last qualifying weekday - computed the
  // same way regardless of which day is being rendered, so every caller reports one cutoff.
  let cutoffDate = earliestDate;
  while (dayStart(nextWeekdayAfter(cutoffDate)).getTime() <= deadlineAtMs) {
    cutoffDate = nextWeekdayAfter(cutoffDate);
  }
  return { earliestDate, cutoffDate, deadlineAtMs };
}

/**
 * The last weekday `cell` could still be reused - the earlier of its 108h window closing and
 * its physical tray being evicted by a successor tray (see reuseWindow / computeTrayEviction-
 * Dates) - i.e. the final day its still-open capacity is salvageable before the tray holding
 * it is disposed with that capacity stranded. null for a cell that carries no deadline of its
 * own: no usable remaining capacity, or no running 108h clock yet (a never-used tray sibling
 * has a reserved well but no first use, so nothing to time out).
 */
function cellReuseCutoffDate(cell: CellOut, evictionDate?: string | null): string | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0 || cell.uses_consumed <= 0) return null;
  return reuseWindow(cell, evictionDate)?.cutoffDate ?? null;
}

/**
 * Whether `cell` is waiting to be reused on `day` (a weekday), and if so, how urgent that
 * looks. Returns null when the cell isn't an open, idle, previously-used cell, `day` falls
 * outside its reuse window, or the window has already closed. Pure function of
 * already-fetched CellOut data - no "now" dependency, so the same day always renders the
 * same way regardless of when the page happens to be viewed.
 */
export function computeGhost(
  cell: CellOut,
  day: string,
  trayFoundingDates: Map<number, string> = new Map(),
  trayEvictionDates: Map<number, string> = new Map(),
): CellGhost | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0) return null;
  if (cell.uses_consumed <= 0 || !cell.last_use_run_date || !cell.current_instrument_serial) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const foundingDate = cell.tray_id !== null ? trayFoundingDates.get(cell.tray_id) : undefined;
  const evictionDate = cell.tray_id !== null ? trayEvictionDates.get(cell.tray_id) : undefined;
  // A successor tray has taken this carousel position, so this cell's whole physical tray has
  // left the instrument - it can't be reused (or even shown as a reuse offer) any more.
  if (evictionDate !== undefined && day >= evictionDate) return null;

  if (day < cell.last_use_run_date) {
    // A day strictly before this cell's own last (possibly not-yet-run) use - that use
    // already claims this exact well, so it's not a droppable "+" here either, even though
    // the cell still has real spare capacity and isn't terminal (see
    // CellGhost.pendingReuseStatus). The last-use day itself, and any weekend between it and
    // the next eligible weekday, fall through to the plain `day < earliestDate` null below -
    // the real stage already renders on the last-use day itself.
    return {
      cell,
      useNumber: cell.uses_consumed + 1,
      isHardCutoff: false,
      fadeOpacity: 1,
      cutoffDate: day,
      deadlineAt: "",
      deadlineIsEstimated: false,
      pendingReuseStatus: true,
      beforeTrayFounding: foundingDate !== undefined && day < foundingDate,
    };
  }

  // The 108h clock's real anchor is when Use 1 is actually confirmed loaded
  // (first_use_started_at); until then, reuseWindow falls back to its *planned* loading time
  // as a provisional estimate so a not-yet-confirmed cell still shows a concrete, bounded
  // deadline instead of reading as available indefinitely.
  const deadlineIsEstimated = !cell.first_use_started_at;
  const window = reuseWindow(cell, evictionDate);
  if (!window) return null; // no cycle for the first use, or the window has already closed
  const { earliestDate, cutoffDate, deadlineAtMs } = window;
  if (day < earliestDate) return null;

  const thisDayStart = dayStart(day).getTime();
  if (thisDayStart > deadlineAtMs) return null; // already past the cutoff

  const isHardCutoff = day === cutoffDate;

  // Dark (full colour) when far from the deadline, fading toward light as it approaches.
  const hoursToDeadline = (deadlineAtMs - thisDayStart) / 3_600_000;
  const fadeOpacity = expiryFadeOpacity(hoursToDeadline);

  return {
    cell,
    useNumber: cell.uses_consumed + 1,
    isHardCutoff,
    fadeOpacity,
    cutoffDate,
    deadlineAt: new Date(deadlineAtMs).toISOString(),
    deadlineIsEstimated,
  };
}

/**
 * Whether `cell` is a never-yet-used sibling of an already-live physical tray, waiting to
 * be shown (and eventually loaded) in its own reserved well on `day`. Distinct from
 * computeGhost (mutually exclusive via uses_consumed): there's no 108h clock running yet
 * (see docs/pacbio-sprq-nx-scheduling-reference.md's "Tray-of-4 eager population" section),
 * so this has no fade/cutoff - it just persists on every weekday, with no start-date gate,
 * until it's actually used (or retired). Deliberately NOT gated on cell.created_at (the row's
 * real insert time): a sample can legitimately be scheduled onto any weekday in the visible
 * week regardless of when "now" actually is, e.g. placing onto Monday's slot on a Thursday -
 * gating on created_at hid the siblings on every day before that real-world insert moment,
 * even within the same week as their own founding placement.
 */
export function computeUnusedTraySiblingGhost(
  cell: CellOut,
  day: string,
  trayFoundingDates: Map<number, string> = new Map(),
  trayEvictionDates: Map<number, string> = new Map(),
): CellGhost | null {
  if (cell.status !== "open" || cell.uses_consumed > 0) return null;
  if (!cell.current_instrument_serial || !cell.current_well) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  // A successor tray has taken this carousel position from `evictionDate` on, so this
  // never-used sibling's physical tray has left the instrument - stop showing its reserved
  // well (a genuinely idle "+" belongs there now, ready for the successor's own cells).
  const evictionDate = cell.tray_id !== null ? trayEvictionDates.get(cell.tray_id) : undefined;
  if (evictionDate !== undefined && day >= evictionDate) return null;

  const foundingDate = cell.tray_id !== null ? trayFoundingDates.get(cell.tray_id) : undefined;

  return {
    cell,
    useNumber: 1,
    isHardCutoff: false,
    fadeOpacity: 1,
    cutoffDate: day,
    deadlineAt: "",
    deadlineIsEstimated: false,
    unused: true,
    beforeTrayFounding: foundingDate !== undefined && day < foundingDate,
  };
}

/**
 * Whether `cell` has gone terminal by ordinary attrition - exhausted (used up its lawful
 * uses), window_expired (108h deadline closed with capacity still unused), or retired
 * (manually written off, e.g. via a never-yet-used sibling's "Discard remaining use(s)")
 * - and if so, still shows its old well as an informational marker on `day` rather than
 * letting it silently fall back to a bare "+" indistinguishable from a well that never
 * held anything. No day-gating otherwise, same as computeUnusedTraySiblingGhost - it
 * persists on every weekday until superseded by a real placement. Deliberately excludes
 * "stopped" (see groupBlockedWellsByInstrument): a QC stop permanently locks its well
 * against reuse, but exhaustion/expiry/retirement are routine turnover. Once
 * `vacatedTrayIds` shows every sibling in this cell's physical tray has also gone terminal
 * or stopped (see computeVacatedTrayIds), the physical tray has genuinely left the
 * instrument - at that point there's nothing left to show a marker for, so this returns
 * null and the well falls straight through to an ordinary droppable "+", ready for a
 * brand-new tray. Cells with no tray_id at all (no siblings to wait on) are always treated
 * as vacated the moment they themselves go terminal.
 */
export function computeTerminalGhost(
  cell: CellOut,
  day: string,
  vacatedTrayIds: Set<number> = new Set(),
): CellGhost | null {
  if (cell.status !== "exhausted" && cell.status !== "window_expired" && cell.status !== "retired") return null;
  if (!cell.current_instrument_serial || !cell.current_well) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;
  if (cell.tray_id === null || vacatedTrayIds.has(cell.tray_id)) return null;
  // exhausted/window_expired can be reached purely by *scheduling* every remaining use up
  // front, before any of them have actually run - see computePendingTerminalGhost, which
  // covers `day` values before this boundary. retired has no such boundary (a one-off manual
  // write-off, not a byproduct of pre-scheduling), so it stays gated only on status/weekday.
  if (cell.status !== "retired") {
    const boundary = terminalBoundaryDate(cell);
    if (boundary && day < boundary) return null;
  }

  return {
    cell,
    useNumber: cell.uses_consumed,
    isHardCutoff: false,
    fadeOpacity: 1,
    cutoffDate: day,
    deadlineAt: "",
    deadlineIsEstimated: false,
    terminalStatus: cell.status,
  };
}

/**
 * The first day `cell`'s well is genuinely idle after it actually reaches its terminal
 * status - the boundary computeTerminalGhost and computePendingTerminalGhost split on.
 * For "exhausted", that's simply the weekday after its last *scheduled* use
 * (last_use_run_date) - mirrors computeGhost's own earliestDate, since the stage-based
 * renderer already covers last_use_run_date itself via the cell's real placement that day.
 * For "window_expired", it's the actual calendar day the 108h deadline closes, found via the
 * same anchor/walk computeGhost uses for its own cutoffDate. Returns null when there isn't
 * enough data to compute a boundary (e.g. no last_use_run_date at all) - callers treat that
 * as "no pending window", i.e. already terminal on every visible day, same as before this
 * function existed.
 */
function terminalBoundaryDate(cell: CellOut): string | null {
  if (!cell.last_use_run_date) return null;
  const earliestDate = nextWeekdayAfter(cell.last_use_run_date);
  if (cell.status !== "window_expired") return earliestDate;

  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  if (!anchor) return earliestDate;
  const deadlineAtMs = new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000;
  let cutoffDate = earliestDate;
  while (dayStart(nextWeekdayAfter(cutoffDate)).getTime() <= deadlineAtMs) {
    cutoffDate = nextWeekdayAfter(cutoffDate);
  }
  return nextWeekdayAfter(cutoffDate);
}

/**
 * Whether `cell` has already gone terminal in its aggregate record (exhausted/window_expired)
 * purely because every remaining use is fully *scheduled*, while `day` still falls before the
 * calendar date it actually reaches that state - e.g. three uses booked for Mon/Wed/Fri, with
 * `day` the locked Tue or Thu column in between. Shown as a muted, informational "Scheduled"
 * marker rather than computeTerminalGhost's red terminal badge, since the cell
 * hasn't really used up its capacity as of `day` - it's just fully committed. Excludes
 * "retired" (see computeTerminalGhost's boundary gate) since that status has no such window.
 */
export function computePendingTerminalGhost(cell: CellOut, day: string): CellGhost | null {
  if (cell.status !== "exhausted" && cell.status !== "window_expired") return null;
  if (!cell.current_instrument_serial || !cell.current_well) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const boundary = terminalBoundaryDate(cell);
  if (!boundary || day >= boundary) return null;

  return {
    cell,
    useNumber: cell.uses_consumed,
    isHardCutoff: false,
    fadeOpacity: 1,
    cutoffDate: day,
    deadlineAt: "",
    deadlineIsEstimated: false,
    pendingTerminalStatus: cell.status,
  };
}

/** Mirrors backend/app/engine/constants.py's WELLS - tray 1 is indices 0-3, tray 2 is
 * 4-7. Used to sort ghosts back into the physical tray order their cells last occupied
 * (the cells API's own ordering is newest-first), and by SchedulerDayCell to pin each
 * ghost to that exact slot index - cells stay in the same physical tray/well position
 * for every reuse, never just "the next open slot". */
export const WELL_ORDER = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"];

function wellSortKey(well: string | null): number {
  const i = well ? WELL_ORDER.indexOf(well) : -1;
  return i === -1 ? WELL_ORDER.length : i;
}

/**
 * Pins each waiting-cell ghost to the physical slot (0-7) matching the well its cell last
 * occupied (WELL_ORDER) - cells keep the same physical tray/well position for every reuse,
 * never just "the next open slot", so a ghost only shows if that exact slot is still free
 * (its `slots` entry is null; a real placed stage always wins).
 *
 * Two *different* physical trays occupy the same carousel position - and therefore reuse the
 * same well letters (A01-D01 / A02-D02) - at different times over a week; the well on any
 * given day belongs to whichever tray is actually loaded then. So when two eligible ghosts
 * both map to the same still-free slot, a cell whose physical tray has NOT been founded yet
 * as of this day (beforeTrayFounding - see computeGhost / CellGhost.beforeTrayFounding) must
 * never win the slot over a cell whose tray IS physically present today. Without this, a
 * later tray's not-yet-existent sibling (rendered as a bare "+", since beforeTrayFounding
 * suppresses its label/tint) silently hid the real reuse/expiry ghost of the cell physically
 * sitting in that well, and clicking the "+" opened a cell that can't legally be there - a
 * future tray's cell that would have to teleport out of its own tray into today's. Among
 * ghosts of equal founding-standing, the first in `ghosts` order keeps the slot (see the
 * same-well note in groupWaitingCellsByInstrumentAndDay's callers).
 */
export function pinGhostsToSlots(
  ghosts: CellGhost[],
  slots: readonly (StageOut | null)[],
): Map<SlotIndex, CellGhost> {
  const bySlot = new Map<SlotIndex, CellGhost>();
  for (const ghost of ghosts) {
    const idx = ghost.cell.current_well ? WELL_ORDER.indexOf(ghost.cell.current_well) : -1;
    if (idx < 0 || idx >= slots.length) continue;
    const slot = idx as SlotIndex;
    if (slots[slot] !== null) continue;
    const existing = bySlot.get(slot);
    if (!existing) {
      bySlot.set(slot, ghost);
    } else if (existing.beforeTrayFounding && !ghost.beforeTrayFounding) {
      // A cell whose tray is physically present today displaces one that only provisionally
      // claimed the slot before its own tray was founded.
      bySlot.set(slot, ghost);
    }
  }
  return bySlot;
}

const OCCUPANCY_SEP = "\u0000";
function occupancyKey(instrument: string, well: string): string {
  return `${instrument}${OCCUPANCY_SEP}${well}`;
}

/**
 * Buckets every stopped cell's permanently-dead well by (instrument, day) across the
 * visible window. A stopped cell's well "stays occupied ... as a permanent marker" (see
 * backend cell_service.stop_cell) - no cycle ever fills it again, so without this the slot
 * would silently look like any other free "+" placeholder even though placing a new cell
 * there is pointless (the physical well already holds a dead cell).
 *
 * But that marker only holds for as long as the stopped cell's *own physical tray* is the
 * one loaded in that carousel position. Two different trays reuse the same well letters
 * (A01-D01 / A02-D02) at different times, so a stopped cell in tray A's D01 must NOT keep
 * D01 blocked once tray A has left and a later tray B is founded in the same position -
 * that well now physically belongs to tray B's live cell. So a stopped well is blocked only
 * on days within its own tray's tenure: from that tray's founding (see
 * computeTrayFoundingDates) up to, but not including, the founding of the next tray to
 * occupy the same (instrument, well). Stopped cells with no tray_id (legacy cells created
 * before tray tracking) have no tenure to bound, so they fall back to the original
 * behaviour - blocked on every visible day. `cells` should be the wider open+terminal+
 * stopped universe (same as computeVacatedTrayIds), so the founding of a *later* tray that
 * takes over the well is visible even though that tray's own cells aren't stopped;
 * `trayFoundingDates` must be built from that same universe.
 */
export function computeBlockedWellsByInstrumentAndDay(
  cells: CellOut[],
  days: string[],
  trayFoundingDates: Map<number, string> = new Map(),
): Map<string, Map<string, Set<string>>> {
  // Per (instrument, well), the ascending founding dates of every tray that occupies it -
  // used to find when the *next* tray takes over a stopped cell's well.
  const occupancy = new Map<string, string[]>();
  for (const cell of cells) {
    if (cell.tray_id === null || !cell.current_instrument_serial || !cell.current_well) continue;
    const founding = trayFoundingDates.get(cell.tray_id);
    if (!founding) continue;
    const key = occupancyKey(cell.current_instrument_serial, cell.current_well);
    const list = occupancy.get(key);
    if (list) {
      if (!list.includes(founding)) list.push(founding);
    } else {
      occupancy.set(key, [founding]);
    }
  }
  for (const list of occupancy.values()) list.sort();

  const out = new Map<string, Map<string, Set<string>>>();
  function block(instrument: string, well: string, day: string) {
    let byDay = out.get(instrument);
    if (!byDay) {
      byDay = new Map();
      out.set(instrument, byDay);
    }
    let wells = byDay.get(day);
    if (!wells) {
      wells = new Set();
      byDay.set(day, wells);
    }
    wells.add(well);
  }

  for (const cell of cells) {
    if (cell.status !== "stopped" || !cell.current_instrument_serial || !cell.current_well) continue;
    const instrument = cell.current_instrument_serial;
    const well = cell.current_well;
    const founding = cell.tray_id !== null ? trayFoundingDates.get(cell.tray_id) : undefined;
    if (!founding) {
      // No tray tenure to bound (legacy cell, or a tray with no first use on record) -
      // preserve the original "blocked on every visible day" behaviour.
      for (const day of days) block(instrument, well, day);
      continue;
    }
    const foundings = occupancy.get(occupancyKey(instrument, well)) ?? [founding];
    const nextTrayFounding = foundings.find((f) => f > founding);
    for (const day of days) {
      if (day >= founding && (nextTrayFounding === undefined || day < nextTrayFounding)) {
        block(instrument, well, day);
      }
    }
  }
  return out;
}

/** The physical carousel position a well sits in - tray 1 is wells A01-D01 (index 0-3),
 * tray 2 is A02-D02 (4-7). A physical tray occupies exactly one position, and only one tray
 * can be in a position at a time, so this is the grain at which one tray evicts another. */
function trayPositionGroup(well: string | null): number {
  const idx = well ? WELL_ORDER.indexOf(well) : -1;
  return idx < 0 ? -1 : Math.floor(idx / 4);
}

/**
 * For each physical tray, the founding date of the *next* tray to take over its carousel
 * position - i.e. the day that tray is physically removed from the instrument. A cell keeps a
 * fixed tray/well position for life and two trays can never share one carousel position (see
 * docs/pacbio-sprq-nx-scheduling-reference.md), so once a successor tray is founded in the
 * same position (tray 1 = wells A01-D01, tray 2 = A02-D02), the entire prior tray - every one
 * of its cells, including wells the successor doesn't refill - has necessarily left, and none
 * of its cells can be reused from that day on. Trays with no successor (the one currently
 * loaded in that position) are absent from the map. `cells` should be the wider open+terminal
 * +stopped universe and `trayFoundingDates` built from that same universe, so a later tray's
 * founding is visible even when the prior tray's cells have all gone terminal/stopped.
 */
export function computeTrayEvictionDates(
  cells: CellOut[],
  trayFoundingDates: Map<number, string>,
): Map<number, string> {
  // Per (instrument, position group), the founding date of every tray occupying it. One
  // entry per tray - all four of a tray's cells share a position, so the first is enough.
  const byPosition = new Map<string, { founding: string; trayId: number }[]>();
  const seenTrays = new Set<number>();
  for (const cell of cells) {
    if (cell.tray_id === null || seenTrays.has(cell.tray_id)) continue;
    if (!cell.current_instrument_serial || !cell.current_well) continue;
    const group = trayPositionGroup(cell.current_well);
    if (group < 0) continue;
    const founding = trayFoundingDates.get(cell.tray_id);
    if (!founding) continue;
    seenTrays.add(cell.tray_id);
    const key = `${cell.current_instrument_serial}${OCCUPANCY_SEP}${group}`;
    const list = byPosition.get(key);
    if (list) list.push({ founding, trayId: cell.tray_id });
    else byPosition.set(key, [{ founding, trayId: cell.tray_id }]);
  }

  const evictions = new Map<number, string>();
  for (const list of byPosition.values()) {
    list.sort((a, b) => (a.founding < b.founding ? -1 : a.founding > b.founding ? 1 : 0));
    for (const entry of list) {
      const next = list.find((e) => e.founding > entry.founding);
      if (next) evictions.set(entry.trayId, next.founding);
    }
  }
  return evictions;
}

/** One physical tray whose next physical disposal will waste still-unused cell capacity -
 * surfaced next to Confirm loaded on the tray's genuine last-chance day: the last day it's
 * still present and still holds salvageable capacity, bounded by its cells' 108h reuse cutoffs
 * and by a successor tray evicting it (see computeTrayDisposalWarnings / SchedulerDayCell). */
export interface TrayDisposalWarning {
  /** The physical tray's id (same id the tray Discard action targets). */
  trayId: number;
  /** "Tray 1" / "Tray 2" carousel position, derived from the cells' well letters. */
  positionLabel: string;
  /** The still-open cells in this tray that keep unused capacity - each will be physically
   * disposed with these uses unspent once the tray leaves, in tray-position order. */
  wastedCells: { code: string; well: string | null; usesRemaining: number }[];
  /** Total unused cell-uses across wastedCells. */
  wastedUses: number;
  /** True when the deadline is being forced by a *successor* tray founded in this carousel
   * position (the tray must be disposed to make room), rather than only its cells' own 108h
   * windows running out - lets the UI say why this is the last chance. */
  evictedBySuccessor: boolean;
}

function trayPositionLabel(cells: CellOut[]): string {
  const well = cells.find((c) => c.current_well)?.current_well;
  const idx = well ? WELL_ORDER.indexOf(well) : -1;
  if (idx < 0) return "Tray";
  return idx < 4 ? "Tray 1" : "Tray 2";
}

/**
 * Buckets, by (instrument, day), every physical tray whose disposal will waste still-unused
 * cell capacity - keyed to the tray's genuine *last chance* day, so the warning lands right
 * where the user can still act (next to Confirm loaded). That day is the latest day the tray
 * is both still physically present AND still holds salvageable capacity:
 *   - a still-open, previously-used cell keeps loadable capacity right up to its reuse cutoff
 *     (the earlier of its 108h window closing and the tray being evicted - see reuseWindow /
 *     computeTrayEvictionDates), so the tray isn't disposed-with-waste until then, not on its
 *     final *scheduled* run. This stops a freshly-loaded tray (used once Monday, cells good
 *     all week) from crying waste on Monday when the real deadline is Friday;
 *   - a never-used sibling has no clock of its own, but if a successor tray is founded in the
 *     same carousel position the whole tray must physically leave, so its last usable day is
 *     the weekday before that eviction - the "dispose the old tray to make room" deadline.
 * Falls back to the last scheduled-use day when neither force gives a later deadline. A tray
 * is flagged only when its last scheduled use falls within the visible window (before then it
 * may still gain more uses, and there's no column to warn on) and it still has open cells with
 * uses_remaining > 0. A deadline spilling past the visible window is clamped to the last
 * column so the warning still surfaces. Fully-consumed trays produce nothing. `cells` should
 * be the wider open+terminal+stopped universe so a tray's true last-use day and full
 * membership are visible; only its still-open cells count as wasted (terminal/stopped cells
 * have no live capacity left to strand). `trayEvictionDates` should be computed from that same
 * universe (see computeTrayEvictionDates).
 */
export function computeTrayDisposalWarnings(
  cells: CellOut[],
  days: string[],
  trayEvictionDates: Map<number, string> = new Map(),
): Map<string, Map<string, TrayDisposalWarning[]>> {
  const byTray = new Map<number, CellOut[]>();
  for (const cell of cells) {
    if (cell.tray_id === null) continue;
    const siblings = byTray.get(cell.tray_id);
    if (siblings) siblings.push(cell);
    else byTray.set(cell.tray_id, [cell]);
  }

  const daySet = new Set(days);
  const lastVisibleDay = days[days.length - 1];
  const out = new Map<string, Map<string, TrayDisposalWarning[]>>();
  for (const [trayId, siblings] of byTray) {
    const instrument = siblings.find((c) => c.current_instrument_serial)?.current_instrument_serial;
    if (!instrument) continue;

    let lastUseDay: string | null = null;
    for (const c of siblings) {
      if (c.last_use_run_date && (lastUseDay === null || c.last_use_run_date > lastUseDay)) {
        lastUseDay = c.last_use_run_date;
      }
    }
    // Only flag a tray whose last scheduled use actually falls on a rendered day - before
    // then it may still gain more uses; there's no run column to warn against yet.
    if (lastUseDay === null || !daySet.has(lastUseDay)) continue;

    const wasted = siblings
      .filter((c) => c.status === "open" && c.uses_remaining > 0)
      .sort((a, b) => wellSortKey(a.current_well) - wellSortKey(b.current_well));
    if (wasted.length === 0) continue;

    // The day a successor tray takes this carousel position, if any - the tray is physically
    // gone from then on, so the last day it's still present is the weekday before.
    const evictionDate = trayEvictionDates.get(trayId);
    const evictionFloor = evictionDate ? prevWeekdayBefore(evictionDate) : null;

    // Push the warning out to the last day this tray's capacity is still salvageable.
    let warnDay = lastUseDay;
    for (const c of wasted) {
      if (c.uses_consumed > 0) {
        // A used cell is reusable up to its own cutoff (already capped by eviction).
        const cutoff = cellReuseCutoffDate(c, evictionDate);
        if (cutoff && cutoff > warnDay) warnDay = cutoff;
      } else if (evictionFloor && evictionFloor > warnDay) {
        // A never-used sibling has no clock, so it stays usable right up to eviction.
        warnDay = evictionFloor;
      }
    }
    if (!daySet.has(warnDay)) {
      // A deadline beyond the visible week has no column of its own - surface it on the last
      // visible day rather than dropping the warning; otherwise fall back to the last use.
      warnDay = warnDay > lastVisibleDay ? lastVisibleDay : lastUseDay;
    }

    const wastedCells = wasted.map((c) => ({ code: c.code, well: c.current_well, usesRemaining: c.uses_remaining }));
    const warning: TrayDisposalWarning = {
      trayId,
      positionLabel: trayPositionLabel(siblings),
      wastedCells,
      wastedUses: wastedCells.reduce((sum, c) => sum + c.usesRemaining, 0),
      evictedBySuccessor: evictionDate !== undefined,
    };

    let byDay = out.get(instrument);
    if (!byDay) {
      byDay = new Map();
      out.set(instrument, byDay);
    }
    const list = byDay.get(warnDay);
    if (list) list.push(warning);
    else byDay.set(warnDay, [warning]);
  }
  return out;
}

/**
 * Physical tray IDs where every one of the tray's sibling cells has gone terminal
 * (exhausted/window_expired/retired) or been stopped - i.e. not one of them still holds
 * real, loadable capacity, so the whole physical tray can be treated as having actually
 * left the instrument. Feeds computeTerminalGhost, which stops showing any marker at all
 * for a tray once it shows up here: until then, dropping a new cell onto any one of its
 * wells would silently mint a second physical tray on top of siblings that are still
 * really sitting there. `cells` must cover every status a tray-linked cell can be in -
 * open, terminal, and stopped (see SchedulePage's three cell queries) - otherwise a
 * sibling simply missing from the list reads as "no capacity" instead of the true "still
 * open" it may well be.
 */
export function computeVacatedTrayIds(cells: CellOut[]): Set<number> {
  const byTray = new Map<number, CellOut[]>();
  for (const cell of cells) {
    if (cell.tray_id === null) continue;
    const siblings = byTray.get(cell.tray_id);
    if (siblings) siblings.push(cell);
    else byTray.set(cell.tray_id, [cell]);
  }
  const vacated = new Set<number>();
  for (const [trayId, siblings] of byTray) {
    if (siblings.every((c) => c.status !== "open")) vacated.add(trayId);
  }
  return vacated;
}

/**
 * Buckets every idle cell's ghost(s) by (current instrument, day) across the visible
 * window - mirrors groupCyclesByInstrumentAndDay's shape so the grid can look ghosts up
 * the same way it looks up real cycles. `cells` is expected to be the union of open cells
 * (computeGhost/computeUnusedTraySiblingGhost) and terminal-by-attrition cells
 * (computeTerminalGhost/computePendingTerminalGhost) - the four compute functions are
 * mutually exclusive (by status, and for the terminal pair, by which side of
 * terminalBoundaryDate `day` falls on), so no cell ever produces more than one ghost for a
 * given day. `vacatedTrayIds` (see computeVacatedTrayIds), `trayFoundingDates` (see
 * computeTrayFoundingDates) and `trayEvictionDates` (see computeTrayEvictionDates) should all
 * be computed from the wider cell universe that also includes stopped cells, so pass them in
 * separately rather than deriving them from `cells`.
 */
export function groupWaitingCellsByInstrumentAndDay(
  cells: CellOut[],
  days: string[],
  vacatedTrayIds: Set<number> = new Set(),
  trayFoundingDates: Map<number, string> = new Map(),
  trayEvictionDates: Map<number, string> = new Map(),
): Map<string, Map<string, CellGhost[]>> {
  const byInstrument = new Map<string, Map<string, CellGhost[]>>();

  // Sort by the well each cell was last removed from, so ghosts reappear in the same
  // top-to-bottom tray order the samples were actually loaded in last time, rather than
  // in the cells API's newest-first order.
  const orderedCells = [...cells].sort((a, b) => wellSortKey(a.current_well) - wellSortKey(b.current_well));

  for (const cell of orderedCells) {
    if (!cell.current_instrument_serial) continue;
    for (const day of days) {
      const ghost =
        computeGhost(cell, day, trayFoundingDates, trayEvictionDates) ??
        computeUnusedTraySiblingGhost(cell, day, trayFoundingDates, trayEvictionDates) ??
        computePendingTerminalGhost(cell, day) ??
        computeTerminalGhost(cell, day, vacatedTrayIds);
      if (!ghost) continue;

      let byDate = byInstrument.get(cell.current_instrument_serial);
      if (!byDate) {
        byDate = new Map();
        byInstrument.set(cell.current_instrument_serial, byDate);
      }
      const list = byDate.get(day);
      if (list) list.push(ghost);
      else byDate.set(day, [ghost]);
    }
  }

  return byInstrument;
}

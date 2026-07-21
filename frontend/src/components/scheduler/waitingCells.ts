import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
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

function dayStart(isoDate: string): Date {
  const d = parseDateOnly(isoDate);
  d.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  return d;
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
): CellGhost | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0) return null;
  if (cell.uses_consumed <= 0 || !cell.last_use_run_date || !cell.current_instrument_serial) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const foundingDate = cell.tray_id !== null ? trayFoundingDates.get(cell.tray_id) : undefined;

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

  const earliestDate = nextWeekdayAfter(cell.last_use_run_date);
  if (day < earliestDate) return null;

  // The 108h clock's real anchor is when Use 1 is actually confirmed loaded
  // (first_use_started_at); until then, fall back to its *planned* loading time as a
  // provisional estimate so a not-yet-confirmed cell still shows a concrete, bounded
  // deadline instead of reading as available indefinitely.
  const deadlineIsEstimated = !cell.first_use_started_at;
  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  if (!anchor) return null; // no cycle at all for the first use - shouldn't happen once uses_consumed >= 1

  const deadlineAtMs = new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000;
  const thisDayStart = dayStart(day).getTime();
  if (thisDayStart > deadlineAtMs) return null; // already past the cutoff

  // Walk forward from the earliest eligible day to find the actual last qualifying
  // weekday - computed the same way regardless of which day is being rendered, so every
  // ghost for this cell reports the same cutoffDate.
  let cutoffDate = earliestDate;
  while (dayStart(nextWeekdayAfter(cutoffDate)).getTime() <= deadlineAtMs) {
    cutoffDate = nextWeekdayAfter(cutoffDate);
  }
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
): CellGhost | null {
  if (cell.status !== "open" || cell.uses_consumed > 0) return null;
  if (!cell.current_instrument_serial || !cell.current_well) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

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
 * Buckets every stopped cell's well by the instrument it was last sitting on. A stopped
 * cell's well "stays occupied ... as a permanent marker" (see backend cell_service.
 * stop_cell) - no cycle ever fills it again, so without this the slot would silently look
 * like any other free "+" placeholder even though placing a new cell there is pointless
 * (the physical well already holds a dead cell). Unlike computeGhost, this has no per-day
 * gating - a stopped cell's well is blocked on every future day, not just a window.
 */
export function groupBlockedWellsByInstrument(cells: CellOut[]): Map<string, Set<string>> {
  const byInstrument = new Map<string, Set<string>>();
  for (const cell of cells) {
    if (cell.status !== "stopped" || !cell.current_instrument_serial || !cell.current_well) continue;
    let wells = byInstrument.get(cell.current_instrument_serial);
    if (!wells) {
      wells = new Set();
      byInstrument.set(cell.current_instrument_serial, wells);
    }
    wells.add(cell.current_well);
  }
  return byInstrument;
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
 * given day. `vacatedTrayIds` (see computeVacatedTrayIds) and `trayFoundingDates` (see
 * computeTrayFoundingDates) should both be computed from the wider cell universe that also
 * includes stopped cells, so pass them in separately rather than deriving them from `cells`.
 */
export function groupWaitingCellsByInstrumentAndDay(
  cells: CellOut[],
  days: string[],
  vacatedTrayIds: Set<number> = new Set(),
  trayFoundingDates: Map<number, string> = new Map(),
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
        computeGhost(cell, day, trayFoundingDates) ??
        computeUnusedTraySiblingGhost(cell, day, trayFoundingDates) ??
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

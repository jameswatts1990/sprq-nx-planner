import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { DAY_START_HOUR, isWeekendUTC, nextWeekdayIsoUTC, parseDateOnly } from "@/utils/calendarDates";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

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
  /** Set for a cell that has gone terminal by ordinary attrition - fully used up
   * (exhausted), timed out with capacity still unused (window_expired), or manually
   * written off (retired) - rendered as a minimal non-droppable "spent well" marker while
   * its physical tray is still loaded (see computeTerminalGhost / SchedulerSlotView).
   * Distinct from a *stopped* cell (see SchedulerSlot's `blocked` prop): stop_cell is a QC
   * action that permanently locks its well, whereas these three are routine turnover, so the
   * well underneath becomes a fully valid drop target for a brand-new tray once every sibling
   * has also gone terminal. When set, the reuse-offer fields (useNumber/isHardCutoff/
   * fadeOpacity/cutoffDate/deadlineAt/deadlineIsEstimated) carry no meaning. */
  terminalStatus?: Exclude<CellStatus, "open" | "stopped">;
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

function dayStart(isoDate: string): Date {
  const d = parseDateOnly(isoDate);
  d.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  return d;
}

/** Walks forward from `earliestDate` to the last weekday whose day-start still falls on or
 * before `deadlineAtMs`. Computed the same way regardless of which day is being rendered,
 * so every caller reports one cutoff. Shared by reuseWindow (the reuse cutoff) and
 * terminalBoundaryDate (the window_expired boundary). */
function lastWeekdayWithin(earliestDate: string, deadlineAtMs: number): string {
  let cutoffDate = earliestDate;
  while (dayStart(nextWeekdayIsoUTC(cutoffDate)).getTime() <= deadlineAtMs) {
    cutoffDate = nextWeekdayIsoUTC(cutoffDate);
  }
  return cutoffDate;
}

/** Buckets cells by their physical tray id (skipping tray-less cells). Used by the
 * tray-level derivations that need "all siblings of a tray" (computeVacatedTrayIds). */
function groupCellsByTray(cells: CellOut[]): Map<number, CellOut[]> {
  const byTray = new Map<number, CellOut[]>();
  for (const cell of cells) {
    if (cell.tray_id === null) continue;
    const siblings = byTray.get(cell.tray_id);
    if (siblings) siblings.push(cell);
    else byTray.set(cell.tray_id, [cell]);
  }
  return byTray;
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
 * same window. Used by computeGhost (per-day reuse ghost).
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
  const earliestDate = nextWeekdayIsoUTC(cell.last_use_run_date);
  if (dayStart(earliestDate).getTime() > deadlineAtMs) return null; // window shuts before any reuse day
  const cutoffDate = lastWeekdayWithin(earliestDate, deadlineAtMs);
  return { earliestDate, cutoffDate, deadlineAtMs };
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
  _trayFoundingDates: Map<number, string> = new Map(),
  trayEvictionDates: Map<number, string> = new Map(),
): CellGhost | null {
  if (cell.status !== "open" || cell.uses_remaining <= 0) return null;
  if (cell.uses_consumed <= 0 || !cell.last_use_run_date || !cell.current_instrument_serial) return null;
  if (isWeekendUTC(parseDateOnly(day))) return null;

  const evictionDate = cell.tray_id !== null ? trayEvictionDates.get(cell.tray_id) : undefined;
  // A successor tray has taken this carousel position, so this cell's whole physical tray has
  // left the instrument - it can't be reused (or even shown as a reuse offer) any more.
  if (evictionDate !== undefined && day >= evictionDate) return null;

  // A day strictly before this cell's own last (possibly not-yet-run) use no longer paints a
  // "Scheduled" marker - only the instrument lock blocks a slot now. Such a well simply falls
  // through to a plain droppable "+" (the drop resolves through derive_best_cell like any
  // other), and the real stage still renders on the last-use day itself.
  if (day < cell.last_use_run_date) return null;

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
 * Best-effort drag-time preview: would dropping `sample` onto this reuse ghost's cell burn a
 * barcode that cell already carries from a DIFFERENT sample? Mirrors the backend's
 * foreign_barcode_clash (a cell's next use is never rerouted to dodge a clash - see
 * placement_service._reuse_eligible / docs/pacbio-sprq-nx-scheduling-reference.md), so a
 * manual drop is warned about the exact clash it will actually surface as StageOut.barcode_clash
 * once placed, not a hypothetical one. Approximate on purpose: CellOut only carries the cell's
 * AGGREGATE burned_barcodes plus which Container IDs have ever used it (`uses`), not a
 * per-barcode owner map, so this treats "the dragged sample's own Container ID has used this
 * cell before" as exempt from every one of its burns (the common "duplicate Container ID
 * reusing its own cell" case - see cell_service.foreign_barcode_clash) rather than checking
 * barcode-by-barcode. The authoritative, exact answer is always the post-drop
 * StageOut.barcode_clash flag and the slot-detail warning - this only lights up danger zones
 * before the user commits to a drop. A terminal ghost (exhausted/expired) can never actually be
 * picked for a reuse, so it never warns. */
export function ghostWouldClashWithSample(
  ghost: CellGhost | undefined,
  sample: { external_id: string; barcodes: string[] },
): boolean {
  if (!ghost || ghost.terminalStatus || sample.barcodes.length === 0) return false;
  const cell = ghost.cell;
  if (cell.burned_barcodes.length === 0) return false;
  const alreadyOwnsThisCell = cell.uses.some((u) => u.sample_external_id === sample.external_id);
  if (alreadyOwnsThisCell) return false;
  return cell.burned_barcodes.some((b) => sample.barcodes.includes(b));
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
  // front, before any of them have actually run. On `day` values before this boundary the
  // well isn't dead yet (its scheduled uses render as real stages, or the gap days show a
  // plain "+"), so the terminal marker only appears once the cell has genuinely finished.
  // retired has no such boundary (a one-off manual write-off, not a byproduct of
  // pre-scheduling), so it stays gated only on status/weekday.
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
 * status - the boundary before which computeTerminalGhost stays silent (the well's scheduled
 * uses still render as real stages, gap days as a plain "+").
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
  const earliestDate = nextWeekdayIsoUTC(cell.last_use_run_date);
  if (cell.status !== "window_expired") return earliestDate;

  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  if (!anchor) return earliestDate;
  const deadlineAtMs = new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000;
  return nextWeekdayIsoUTC(lastWeekdayWithin(earliestDate, deadlineAtMs));
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
 * Pins each ghost to the physical slot (0-7) matching the well its cell last occupied
 * (WELL_ORDER) - cells keep the same physical tray/well position for life, so a ghost only
 * shows if that exact slot is still free (its `slots` entry is null; a real placed stage
 * always wins). Only one live tray occupies a given carousel position on any given day (a
 * successor tray can't be founded until the prior one is evicted - see computeTrayEviction-
 * Dates), so at most one ghost maps to a slot per day; on the rare tie the first in `ghosts`
 * order keeps it.
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
    if (!bySlot.has(slot)) bySlot.set(slot, ghost);
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
    if (founding === undefined) {
      // No tray tenure of its own to bound this block with. A true legacy cell (tray_id ===
      // null, predating tray tracking entirely) necessarily predates every tray-tracked
      // founding date on record for this well - so if a tray-tracked successor has since been
      // founded in this exact (instrument, well), that successor has physically evicted this
      // legacy cell's well regardless of when precisely that happened, and the block must end
      // there (mirroring the ordinary tracked-eviction case below) rather than staying blocked
      // forever - the bug this branch used to have (see docs - a real successor tray landing
      // in a legacy stopped cell's old well stayed permanently undroppable). A tray_id that IS
      // set but whose founding merely failed to resolve (its founding cell's own anchor was
      // cleared or missing) has no such ordering guarantee against occupancy's other entries,
      // so it keeps the original "blocked on every visible day" fallback.
      if (cell.tray_id === null) {
        const successorFoundings = occupancy.get(occupancyKey(instrument, well));
        const successorFounding = successorFoundings?.[0];
        for (const day of days) {
          if (successorFounding === undefined || day < successorFounding) block(instrument, well, day);
        }
      } else {
        for (const day of days) block(instrument, well, day);
      }
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
  const vacated = new Set<number>();
  for (const [trayId, siblings] of groupCellsByTray(cells)) {
    if (siblings.every((c) => c.status !== "open")) vacated.add(trayId);
  }
  return vacated;
}

/**
 * Buckets every idle cell's ghost(s) by (current instrument, day) across the visible
 * window - mirrors groupCyclesByInstrumentAndDay's shape so the grid can look ghosts up
 * the same way it looks up real cycles. `cells` is expected to be the union of open cells
 * (computeGhost/computeUnusedTraySiblingGhost) and terminal-by-attrition cells
 * (computeTerminalGhost) - the three compute functions are mutually exclusive by status, so
 * no cell ever produces more than one ghost for a given day. `vacatedTrayIds` (see
 * computeVacatedTrayIds), `trayFoundingDates` (see
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
      // A grid slot is a physical WELL that gets a cell assigned when a sample is loaded onto
      // it - so the grid shows only two forward-looking things about an un-loaded well: a reuse
      // OFFER (a used cell physically resident in the well, on its 108h clock, ready to take its
      // next use here - computeGhost), and a spent-well MARKER (a terminal cell still occupying
      // the well because its tray hasn't left the instrument yet - computeTerminalGhost, rendered
      // as a minimal non-droppable marker, not a sample-like card). A never-yet-used tray sibling
      // is NOT surfaced any more: its well simply reads as a plain droppable "+", and dropping a
      // sample there assigns that resident sibling automatically (backend derive_best_cell's
      // reuse-before-new). This keeps the grid a picture of wells-and-loads, not of every cell the
      // trays happen to hold - see the CLAUDE.md "wells assigned a cell on a tray" model.
      const ghost = computeGhost(cell, day, trayFoundingDates, trayEvictionDates) ?? computeTerminalGhost(cell, day, vacatedTrayIds);
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

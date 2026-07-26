import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
import { todayIsoUTC } from "@/utils/calendarDates";
import { CELL_LIFETIME_H } from "@/utils/windowFade";

import { WELL_ORDER } from "./waitingCells";

/** Hours of remaining 108h window below which a still-open cell reads as expiring "soon"
 * (amber). One weekday of head-room. */
export const EXPIRY_SOON_HOURS = 24;

/** The physical breakout stagger: the instrument removes a tray's 4 cells one at a time, ~2h
 * apart, so within one tray cell N breaks out (N-1)*2h after the tray is loaded (a 4-cell run
 * breaks out at T+0/+2/+4/+6). Its 108h clock starts at *its own* breakout, not the load, so a
 * tray's cells expire on a 2h-staggered ladder rather than one shared date. See
 * docs/pacbio-sprq-nx-scheduling-reference.md. */
export const BREAKOUT_STAGGER_H = 2;

/** The gap between an 8-cell load's two trays: the Plate-2 tray (carousel 1) breaks out ~24h
 * after the Plate-1 tray. Both parallel trays share one load anchor (they acquire the same day -
 * see placement_service.py's module docstring), but the instrument works Plate 1 first
 * (T+0..+6) then Plate 2 (T+24..+30), so carousel 1 carries a +24h base offset on top of its
 * own 2h intra-tray ladder. */
export const PLATE_LOAD_GAP_H = 24;

/** A cell's breakout offset from its tray's load anchor, in hours: which carousel box it sits in
 * (0 = Plate 1, 1 = Plate 2) plus its 1-based position within that tray. */
export function breakoutOffsetH(carousel: 0 | 1, cellNumber: number): number {
  return carousel * PLATE_LOAD_GAP_H + Math.max(0, cellNumber - 1) * BREAKOUT_STAGGER_H;
}

/** One cell's slot within a tray box (its fixed A/B/C/D position), carrying the reference-time-
 * independent facts the panel needs to shade it at any instant (end-of-week or live "now"). */
export interface TrayPositionView {
  cellId: number;
  /** The cell's code (e.g. C01-T123), for the position's tooltip. */
  code: string;
  /** The cell's fixed tray position as a NUMBER 1-4 (PacBio "cell 1-4" - cells are numbered,
   * plates are lettered, so the two never read alike). */
  cellNumber: number;
  /** Usable uses still available here (of 3) - the cell's remaining uses while it's still
   * open, and 0 for any terminal/stopped cell (its physical remainder can no longer be run). */
  usesRemaining: number;
  status: CellStatus;
  /** ISO datetime this specific cell is removed from the tray (its own 108h clock starts): the
   * tray's load anchor + its staggered breakout offset. null when the cell has no running or
   * planned first use yet (nothing on the clock). */
  breakoutAt: string | null;
  /** ISO datetime this cell's 108h window closes (breakoutAt + 108h), or null (no anchor). */
  expiryAt: string | null;
  /** True when the anchor is the cell's *planned* (not yet confirmed-loaded) first use - the
   * real 108h clock only starts on confirmation, so the schedule could still shift it (see
   * docs/pacbio-sprq-nx-scheduling-reference.md #2). */
  provisional: boolean;
}

/** How a tray position reads at a given reference instant. `spent` = benignly used up / retired;
 * `expired` = past its 108h deadline as of the reference (or QC-stopped); `soon` = open, within
 * EXPIRY_SOON_HOURS of the deadline; `ok` = open with comfortable window; `scheduled` = open but
 * its breakout is still in the future (clock not started yet); `fresh` = open, never on a clock. */
export type CellExpiryState = "ok" | "soon" | "expired" | "scheduled" | "spent" | "fresh";

/** Classify a position at reference instant `refMs`. Reference-time-aware so one dataset drives
 * both the end-of-week projection (default) and the live "now" reading (on hover). */
export function cellExpiryState(p: TrayPositionView, refMs: number): CellExpiryState {
  if (p.status === "exhausted" || p.status === "retired") return "spent";
  if (p.status !== "open") return "expired"; // window_expired / stopped - capacity lost
  if (!p.expiryAt) return "fresh"; // open, nothing on the clock yet
  const breakoutMs = p.breakoutAt ? Date.parse(p.breakoutAt) : null;
  if (breakoutMs !== null && refMs < breakoutMs) return "scheduled"; // not broken out yet
  const expiryMs = Date.parse(p.expiryAt);
  if (refMs >= expiryMs) return "expired";
  return (expiryMs - refMs) / 3_600_000 < EXPIRY_SOON_HOURS ? "soon" : "ok";
}

/** One physical SMRT-cell tray (4 cells) resident in a carousel position. */
export interface TrayView {
  trayId: number;
  /** Carousel position: 0 = Plate 1 (wells A01-D01), 1 = Plate 2 (A02-D02). */
  carousel: 0 | 1;
  /** The 4 cells by fixed tray position (A first), padded to whatever siblings are known. */
  positions: TrayPositionView[];
}

/** A tray scheduled to be LOADED later in the viewed week (a mid-week turnover successor),
 * shown by id only rather than with full cell state - it isn't on the instrument yet. */
export interface FutureTrayView {
  trayId: number;
  /** The carousel position it will occupy: 0 = Plate 1, 1 = Plate 2. */
  carousel: 0 | 1;
  /** The weekday (YYYY-MM-DD) it's loaded - its earliest cell's first use. */
  foundingDate: string;
}

/** The on-instrument tray map: the tray resident at the START of the viewed week per carousel
 * position (shown with full cell state), plus any successor trays scheduled to be loaded later
 * that same week (shown by id only). */
export interface InstrumentTrayMap {
  /** The day the resident `carousel` state is anchored to - the first weekday of the viewed
   * window (YYYY-MM-DD), or null when the window is empty. Drives the "as of ..." caption.
   * Deliberately the week's *start*, never its latest scheduled day, so a not-yet-loaded
   * successor is never surfaced as if it were the tray currently on the instrument. */
  asOfDate: string | null;
  /** The last visible weekday of the viewed window (YYYY-MM-DD) - the default reference the
   * panel projects each cell's expiry state to ("stats for the end of the week"), until the
   * user hovers to see the state as of right now. */
  weekEndDate: string | null;
  /** The resident tray (or null = empty carousel position) for Plate 1 [0] and Plate 2 [1],
   * as of `asOfDate`. */
  carousel: [TrayView | null, TrayView | null];
  /** Successor trays founded LATER within the viewed window (after `asOfDate`), sorted by
   * founding day then carousel position - the "loaded later this week" group. */
  futureTrays: FutureTrayView[];
}

/** The carousel position (0 = Plate 1, 1 = Plate 2) a well sits in - mirrors
 * waitingCells.trayPositionGroup / the WELLS split, kept here to avoid exporting a private. */
function carouselOf(well: string | null): 0 | 1 | -1 {
  const idx = well ? WELL_ORDER.indexOf(well) : -1;
  if (idx < 0) return -1;
  return idx < 4 ? 0 : 1;
}

/** The cell's 1-based tray position as a number (1-4). Falls back to mapping its own home-well
 * letter A-D -> 1-4 when tray_position is missing (a legacy tray-less cell). */
function cellNumberOf(cell: CellOut): number {
  if (cell.tray_position != null && cell.tray_position >= 1 && cell.tray_position <= 4) {
    return cell.tray_position;
  }
  return cell.current_well ? cell.current_well.charCodeAt(0) - 64 : 0; // "A" (65) -> 1 .. "D" -> 4
}

function positionView(cell: CellOut, carousel: 0 | 1): TrayPositionView {
  // Real 108h clock once confirmed loaded (first_use_started_at); a planned but unconfirmed
  // first use is only a provisional estimate - same anchor precedence as waitingCells.
  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  const cellNumber = cellNumberOf(cell);
  // Stagger the shared load anchor by this cell's physical breakout order so each cell in a tray
  // gets its own precise 108h clock (2h apart within a tray; +24h for the Plate-2 tray) instead
  // of the single fuzzy date all four used to share.
  const breakoutMs = anchor ? new Date(anchor).getTime() + breakoutOffsetH(carousel, cellNumber) * 3_600_000 : null;
  const breakoutAt = breakoutMs !== null ? new Date(breakoutMs).toISOString() : null;
  const expiryAt = breakoutMs !== null ? new Date(breakoutMs + CELL_LIFETIME_H * 3_600_000).toISOString() : null;
  return {
    cellId: cell.id,
    code: cell.code,
    cellNumber,
    // A terminal/stopped cell offers no usable uses even if it physically has capacity left
    // (e.g. a tray disposed early at the max-uses dial) - show what can still be run: 0.
    usesRemaining: cell.status === "open" ? cell.uses_remaining : 0,
    status: cell.status,
    breakoutAt,
    expiryAt,
    provisional: expiryAt !== null && !cell.first_use_started_at,
  };
}

/**
 * The cell/tray map for every instrument, anchored to the START of the viewed week. For each
 * instrument's two carousel positions it picks the physical tray resident on the week's first
 * day (its tenure [founding, eviction) spans that day) and projects each of that tray's 4 cells
 * to their scheduled-forward state (uses remaining, 108h expiry, urgency) - all read straight
 * from the already-fetched CellOut, whose totals already count planned uses. Separately it
 * collects any *successor* trays founded later in the same week (a mid-week turnover, e.g. when
 * the resident tray ages out of its 108h window and a fresh one is loaded in its place) into
 * `futureTrays`, shown by id only.
 *
 * Anchoring to the week's start (not its latest scheduled day) is deliberate: it keeps the
 * top-of-map state a truthful picture of what's physically on the instrument as the week
 * begins, and surfaces anything loaded later as an explicit "later this week" list rather than
 * silently swapping the resident tray for a not-yet-loaded successor.
 *
 * `allCells` should be the wide open+terminal+stopped universe (SchedulePage's three cell
 * queries), and `trayFoundingDates`/`trayEvictionDates`/`vacatedTrayIds` the same maps
 * SchedulePage already derives from it - reused here so residency agrees exactly with the
 * grid's ghost/eviction logic.
 */
export function computeInstrumentTrayMaps(
  allCells: CellOut[],
  days: string[],
  trayFoundingDates: Map<number, string>,
  trayEvictionDates: Map<number, string>,
  vacatedTrayIds: Set<number>,
): Map<string, InstrumentTrayMap> {
  // Bucket every tray-linked cell by instrument, then tray.
  const byInstrument = new Map<string, Map<number, CellOut[]>>();
  for (const cell of allCells) {
    if (cell.tray_id === null || !cell.current_instrument_serial) continue;
    let byTray = byInstrument.get(cell.current_instrument_serial);
    if (!byTray) {
      byTray = new Map();
      byInstrument.set(cell.current_instrument_serial, byTray);
    }
    const siblings = byTray.get(cell.tray_id);
    if (siblings) siblings.push(cell);
    else byTray.set(cell.tray_id, [cell]);
  }

  // The week's first weekday anchors residency; its last bounds "later this week". An empty
  // window (shouldn't happen in practice) falls back to today so the map still resolves.
  const asOf = days[0] ?? todayIsoUTC();
  const lastDay = days[days.length - 1] ?? asOf;
  const out = new Map<string, InstrumentTrayMap>();

  for (const [serial, byTray] of byInstrument) {
    const carousel: [TrayView | null, TrayView | null] = [null, null];
    const futureTrays: FutureTrayView[] = [];

    // Per carousel position, gather the tray resident at the week's START (keeping the latest-
    // founded on the rare tie) apart from any trays FOUNDED mid-week, so we can tell a genuine
    // turnover (a mid-week tray replacing a start-resident) from a tray that's simply this
    // position's only tray this week (which belongs in the slot, not "loaded later").
    type TrayCand = { trayId: number; founding: string | null; siblings: CellOut[] };
    const startResident: [TrayCand | null, TrayCand | null] = [null, null];
    const midWeek: [TrayCand[], TrayCand[]] = [[], []];

    for (const [trayId, siblings] of byTray) {
      // A fully-vacated tray (every sibling terminal/stopped) with no successor is gone - the
      // physical tray has effectively left; the position reads as empty/loadable.
      if (vacatedTrayIds.has(trayId)) continue;

      // All 4 siblings share one carousel position; read it off the first with a known well.
      const wellCell = siblings.find((c) => c.current_well);
      const raw = carouselOf(wellCell?.current_well ?? null);
      if (raw < 0) continue;
      const pos = raw as 0 | 1;

      const founding = trayFoundingDates.get(trayId) ?? null;
      const eviction = trayEvictionDates.get(trayId);

      // Founded strictly after the anchor day, on or before the last visible day: a candidate to
      // load mid-week. Whether it's a "loaded later" successor or simply this position's own tray
      // is decided below, once we know whether anything is resident at the week's start.
      if (founding !== null && founding > asOf && founding <= lastDay) {
        midWeek[pos].push({ trayId, founding, siblings });
        continue;
      }

      // Otherwise, is it resident on the anchor day? Tenure [founding, eviction) spans it. A
      // never-used tray (no founding anchor) is physically loaded already, so treat it as
      // resident. A tray founded further out than this week is neither resident nor "this week".
      const foundedByNow = founding === null || founding <= asOf;
      const notYetEvicted = eviction === undefined || asOf < eviction;
      if (!foundedByNow || !notYetEvicted) continue;

      // On the rare tie (shouldn't happen - one tray per position at a time), keep the
      // latest-founded so a successor beats its predecessor.
      const current = startResident[pos];
      if (current !== null && (founding ?? "") <= (current.founding ?? "")) continue;
      startResident[pos] = { trayId, founding, siblings };
    }

    // Resolve each position. If a tray is resident at the week's start, it fills the slot and
    // every mid-week tray is a genuine turnover successor ("loaded later"). If the position is
    // empty at the start, the earliest mid-week tray IS this position's tray - show it in the
    // slot, not "loaded later" - and only any later ones are successors.
    for (const pos of [0, 1] as const) {
      const ordered = [...midWeek[pos]].sort((a, b) =>
        (a.founding ?? "") < (b.founding ?? "") ? -1 : (a.founding ?? "") > (b.founding ?? "") ? 1 : a.trayId - b.trayId,
      );
      let resident = startResident[pos];
      let successors = ordered;
      if (!resident && ordered.length > 0) {
        resident = ordered[0];
        successors = ordered.slice(1);
      }
      if (resident) {
        const positions = [...resident.siblings]
          .sort((a, b) => (a.tray_position ?? 0) - (b.tray_position ?? 0))
          .map((c) => positionView(c, pos));
        carousel[pos] = { trayId: resident.trayId, carousel: pos, positions };
      }
      for (const s of successors) {
        futureTrays.push({ trayId: s.trayId, carousel: pos, foundingDate: s.founding as string });
      }
    }

    futureTrays.sort((a, b) =>
      a.foundingDate < b.foundingDate ? -1 : a.foundingDate > b.foundingDate ? 1 : a.carousel - b.carousel,
    );
    out.set(serial, { asOfDate: days[0] ?? null, weekEndDate: days[days.length - 1] ?? null, carousel, futureTrays });
  }

  return out;
}

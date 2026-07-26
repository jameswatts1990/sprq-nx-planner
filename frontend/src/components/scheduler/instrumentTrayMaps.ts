import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
import type { RunOut } from "@/types/schedule";
import { todayIsoUTC } from "@/utils/calendarDates";
import { windowHoursRemaining } from "@/utils/openTrays";
import { CELL_LIFETIME_H } from "@/utils/windowFade";

import { WELL_ORDER } from "./waitingCells";

/** Hours of remaining 108h window below which a still-open, already-used cell is flagged as
 * expiring "soon" (amber). One weekday of head-room. */
export const EXPIRY_SOON_HOURS = 24;

/** How near a cell is to losing its remaining capacity. `expired` = its window has closed or
 * it's otherwise terminal/stopped; `soon` = still open but within EXPIRY_SOON_HOURS of its
 * 108h deadline; `none` = plenty of window left (or not yet on the clock). */
export type ExpiryUrgency = "none" | "soon" | "expired";

/** One cell's slot within a tray box (its fixed A/B/C/D position), projected to the latest
 * scheduled state. */
export interface TrayPositionView {
  cellId: number;
  /** The cell's code (e.g. CELL-A000920), for the position's tooltip. */
  code: string;
  /** The cell's fixed A/B/C/D tray position letter. */
  letter: string;
  /** Usable uses still available here (of 3) - the cell's remaining uses while it's still
   * open, and 0 for any terminal/stopped cell (its physical remainder can no longer be run). */
  usesRemaining: number;
  status: CellStatus;
  /** ISO datetime the cell's 108h window closes (anchor + 108h), or null when the cell has no
   * running/planned first use yet (nothing to time out). */
  expiryAt: string | null;
  /** True when expiryAt is derived from the cell's *planned* (not yet confirmed-loaded) first
   * use - a provisional estimate, since the real 108h clock only starts on confirmation (see
   * docs/pacbio-sprq-nx-scheduling-reference.md #2). */
  expiryEstimated: boolean;
  urgency: ExpiryUrgency;
}

/** One physical SMRT-cell tray (4 cells) resident in a carousel position. */
export interface TrayView {
  trayId: number;
  /** Carousel position: 0 = Plate 1 (wells A01-D01), 1 = Plate 2 (A02-D02). */
  carousel: 0 | 1;
  /** The 4 cells by fixed tray position (A first), padded to whatever siblings are known. */
  positions: TrayPositionView[];
}

/** The projected on-instrument tray map, as of the latest scheduled day in the viewed week. */
export interface InstrumentTrayMap {
  /** The latest scheduled day (YYYY-MM-DD) on this instrument within the visible window, or
   * null when nothing is scheduled this week (the map then shows the currently-resident
   * trays). Drives the "as of ..." caption. */
  asOfDate: string | null;
  /** The resident tray (or null = empty carousel position) for Plate 1 [0] and Plate 2 [1]. */
  carousel: [TrayView | null, TrayView | null];
}

/** The carousel position (0 = Plate 1, 1 = Plate 2) a well sits in - mirrors
 * waitingCells.trayPositionGroup / the WELLS split, kept here to avoid exporting a private. */
function carouselOf(well: string | null): 0 | 1 | -1 {
  const idx = well ? WELL_ORDER.indexOf(well) : -1;
  if (idx < 0) return -1;
  return idx < 4 ? 0 : 1;
}

/** The A/B/C/D letter for a 1-based tray position (1 -> A). Falls back to the cell's own well
 * letter if the position is missing. */
function positionLetter(cell: CellOut): string {
  if (cell.tray_position != null && cell.tray_position >= 1 && cell.tray_position <= 26) {
    return String.fromCharCode("A".charCodeAt(0) + cell.tray_position - 1);
  }
  return cell.current_well ? cell.current_well.charAt(0) : "?";
}

function expiryUrgency(cell: CellOut): ExpiryUrgency {
  if (cell.status !== "open" || cell.window_breached) return "expired";
  const remaining = windowHoursRemaining(cell);
  if (remaining !== null && remaining < EXPIRY_SOON_HOURS) return "soon";
  return "none";
}

function positionView(cell: CellOut): TrayPositionView {
  // Real 108h clock once confirmed loaded (first_use_started_at); a planned but unconfirmed
  // first use is only a provisional estimate - same anchor precedence as waitingCells.
  const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
  const expiryAt = anchor ? new Date(new Date(anchor).getTime() + CELL_LIFETIME_H * 3_600_000).toISOString() : null;
  return {
    cellId: cell.id,
    code: cell.code,
    letter: positionLetter(cell),
    // A terminal/stopped cell offers no usable uses even if it physically has capacity left
    // (e.g. a tray disposed early at the max-uses dial) - show what can still be run: 0.
    usesRemaining: cell.status === "open" ? cell.uses_remaining : 0,
    status: cell.status,
    expiryAt,
    expiryEstimated: expiryAt !== null && !cell.first_use_started_at,
    urgency: expiryUrgency(cell),
  };
}

/** The latest scheduled day on this instrument that falls within the visible window - the
 * "as of" date. Considers both a run's load day and each plate's acquire day (a reuse Plate 2
 * runs a day after loading), bounded to the visible weekdays. null when nothing is scheduled. */
function latestScheduledDay(runsByDate: Map<string, RunOut> | undefined, days: string[]): string | null {
  if (!runsByDate) return null;
  const daySet = new Set(days);
  let latest: string | null = null;
  for (const run of runsByDate.values()) {
    const candidates = [run.load_date, ...run.plates.map((p) => p.acquire_date)];
    for (const day of candidates) {
      if (!daySet.has(day)) continue;
      if (latest === null || day > latest) latest = day;
    }
  }
  return latest;
}

/**
 * The projected cell/tray map for every instrument, as of the latest scheduled day in the
 * viewed week. For each instrument's two carousel positions it picks the physical tray
 * resident on the "as of" day (its tenure [founding, eviction) spans that day) and projects
 * each of that tray's 4 cells to their scheduled-forward state (uses remaining, 108h expiry,
 * urgency) - all read straight from the already-fetched CellOut, whose totals already count
 * planned uses, so no separate projection pass is needed.
 *
 * `allCells` should be the wide open+terminal+stopped universe (SchedulePage's three cell
 * queries), and `trayFoundingDates`/`trayEvictionDates`/`vacatedTrayIds` the same maps
 * SchedulePage already derives from it - reused here so residency agrees exactly with the
 * grid's ghost/eviction logic.
 */
export function computeInstrumentTrayMaps(
  allCells: CellOut[],
  grouped: Map<string, Map<string, RunOut>>,
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

  const today = todayIsoUTC();
  const out = new Map<string, InstrumentTrayMap>();

  for (const [serial, byTray] of byInstrument) {
    const asOfDate = latestScheduledDay(grouped.get(serial), days);
    // With nothing scheduled this week, fall back to "now" so the map shows the trays
    // physically resident today rather than a fully pre-scheduled future week's.
    const effectiveAsOf = asOfDate ?? today;

    const carousel: [TrayView | null, TrayView | null] = [null, null];
    // Per carousel position, remember the resident tray with the latest founding so a
    // same-position turnover picks the successor once it has taken over.
    const bestFounding: [string | null, string | null] = [null, null];

    for (const [trayId, siblings] of byTray) {
      // All 4 siblings share one carousel position; read it off the first with a known well.
      const wellCell = siblings.find((c) => c.current_well);
      const raw = carouselOf(wellCell?.current_well ?? null);
      if (raw < 0) continue;
      const pos = raw as 0 | 1;

      const founding = trayFoundingDates.get(trayId) ?? null;
      const eviction = trayEvictionDates.get(trayId);
      // Resident on effectiveAsOf when its tenure [founding, eviction) spans it. A never-used
      // tray (no founding anchor) is physically loaded already, so treat it as resident.
      const foundedByNow = founding === null || founding <= effectiveAsOf;
      const notYetEvicted = eviction === undefined || effectiveAsOf < eviction;
      if (!foundedByNow || !notYetEvicted) continue;
      // A fully-vacated tray (every sibling terminal/stopped) with no successor is treated as
      // gone - the physical tray has effectively left; the position reads as empty/loadable.
      if (vacatedTrayIds.has(trayId)) continue;

      // On the rare tie (shouldn't happen - one tray per position at a time), keep the
      // latest-founded so a successor beats its predecessor.
      const current = bestFounding[pos];
      if (current !== null && (founding ?? "") <= current) continue;
      bestFounding[pos] = founding ?? "";

      const positions = [...siblings]
        .sort((a, b) => (a.tray_position ?? 0) - (b.tray_position ?? 0))
        .map(positionView);
      carousel[pos] = { trayId, carousel: pos, positions };
    }

    out.set(serial, { asOfDate, carousel });
  }

  return out;
}

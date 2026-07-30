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
  /** Usable uses still available here (of 3) as of the END of the viewed week - the cell's
   * remaining uses once every scheduled use this week has run, and 0 for any terminal/stopped
   * cell (its physical remainder can no longer be run). This is the committed-plan figure; for a
   * reference-time-aware count (how many have actually broken out by a given instant) see
   * usesRemainingAt(). */
  usesRemaining: number;
  /** The cell's total use capacity (3) - the ceiling usesRemainingAt() counts down from. */
  maxUses: number;
  /** Each still-live (non-cancelled) use's own physical breakout instant, in epoch ms: the
   * use's run anchor plus this cell's staggered breakout offset. Sorted ascending. Lets
   * usesRemainingAt() count how many uses have broken out by a reference instant. Empty for a
   * terminal/stopped cell (no usable capacity to count). */
  useBreakoutsMs: number[];
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
 * both the end-of-week projection (default) and the live "now" reading (on hover, `live`).
 *
 * A terminal cell reads used-up/expired by default. But in the live view it may not have
 * physically broken out all its committed uses yet (a staggered later cell in today's run, or a
 * disposal the plan has scheduled for later this week) - while a committed use is still unbroken
 * the cell physically still holds it, so reconstruct its real in-window state instead of a flat
 * "spent". Once every committed use has broken out by `refMs` it reads used-up/expired as before,
 * so the default end-of-week view is unchanged (`live` off, or all uses broken out by then). */
export function cellExpiryState(p: TrayPositionView, refMs: number, live = false): CellExpiryState {
  if (p.status !== "open") {
    // Only an *exhausted* cell (its capacity consumed by the committed plan) can still be
    // physically holding an un-broken-out use in the live view - a staggered later use, or a
    // disposal the plan scheduled ahead. window_expired / stopped / retired are dead for a real
    // reason (window closed, QC-stopped, written off), so they never read as live here.
    const stillHoldsUnbrokenUse = live && p.status === "exhausted" && usesRemainingAt(p, refMs) > 0;
    if (!stillHoldsUnbrokenUse) {
      if (p.status === "exhausted" || p.status === "retired") return "spent";
      return "expired"; // window_expired / stopped - capacity lost
    }
    // else: fall through to the window logic below, reading it as the live cell it still is.
  }
  if (!p.expiryAt) return "fresh"; // nothing on the clock yet
  const breakoutMs = p.breakoutAt ? Date.parse(p.breakoutAt) : null;
  if (breakoutMs !== null && refMs < breakoutMs) return "scheduled"; // not broken out yet
  const expiryMs = Date.parse(p.expiryAt);
  if (refMs >= expiryMs) return "expired";
  return (expiryMs - refMs) / 3_600_000 < EXPIRY_SOON_HOURS ? "soon" : "ok";
}

/** Uses physically on this cell *as of `refMs`* - the count that have not yet broken out by then.
 * At the end-of-week reference this converges on the committed-plan figure (`usesRemaining`, all
 * scheduled uses counted); at a live "now" earlier in the week it reads higher, since a use
 * scheduled for later this week hasn't broken out yet.
 *
 * An OPEN cell counts down from its full capacity (`maxUses` - uses broken out), since it can
 * still take new work up to the cap. A TERMINAL cell won't take more work, so what it still
 * physically holds is only its own committed uses that haven't broken out yet: a staggered later
 * use, or a whole-tray disposal scheduled ahead. Each of those still sits unbroken in the cell,
 * so right now it genuinely still has that use - even though by end of week (all broken out) it
 * reads 0, matching the committed-plan `usesRemaining`. A terminal cell with nothing left to
 * break out (or none scheduled) reads 0. */
export function usesRemainingAt(p: TrayPositionView, refMs: number): number {
  const brokenOut = p.useBreakoutsMs.filter((ms) => ms <= refMs).length;
  if (p.status === "open") return Math.max(0, p.maxUses - brokenOut);
  return Math.max(0, p.useBreakoutsMs.length - brokenOut);
}

/** One physical SMRT-cell tray (4 cells) resident in a carousel position. */
export interface TrayView {
  trayId: number;
  /** Carousel position: 0 = Plate 1 (wells A01-D01), 1 = Plate 2 (A02-D02). */
  carousel: 0 | 1;
  /** The 4 cells by fixed tray position (A first), padded to whatever siblings are known. */
  positions: TrayPositionView[];
}

/** The on-instrument tray map: the tray resident at the END of the viewed week per carousel
 * position, shown with full cell state. Anchored to the week's end so the tray in each slot is
 * the one the panel's caption and cell shading both describe ("state by end of Friday"): when a
 * position turns over mid-week (an aged-out tray replaced by a fresh one), the slot shows the
 * SUCCESSOR that's actually on the instrument by week's end, not the departed predecessor. */
export interface InstrumentTrayMap {
  /** The first weekday of the viewed window (YYYY-MM-DD), or null when the window is empty -
   * informational window metadata only; residency is anchored to `weekEndDate`, not this. */
  asOfDate: string | null;
  /** The last visible weekday of the viewed window (YYYY-MM-DD) - the reference each carousel
   * slot's residency is picked at AND the default reference the panel projects each cell's
   * expiry state to ("state by end of the week"), until the user hovers to see it as of now. */
  weekEndDate: string | null;
  /** The tray resident on `weekEndDate` (or null = empty carousel position) for Plate 1 [0] and
   * Plate 2 [1]. */
  carousel: [TrayView | null, TrayView | null];
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
  const cellNumber = cellNumberOf(cell);
  // The instrument breaks a tray's 4 cells out ~2h apart (a Plate-2 tray a further ~24h later),
  // so each cell's 108h clock starts at its OWN breakout, not the shared load time. WHERE that
  // breakout instant comes from depends on whether the load is confirmed:
  //   - CONFIRMED (first_use_started_at, and a started use's started_at): the backend already
  //     bakes the per-cell stagger into that timestamp at Confirm-loaded (run_service.py -
  //     load + run_breakout_offsets[cell]), so it is the real, already-staggered anchor and must
  //     be used as-is. Adding breakoutOffsetH again here would stagger it a SECOND time.
  //   - PLANNED-only (first_use_planned_start_at, a not-yet-started use): still the single shared
  //     plate timestamp all four cells quote, so it is staggered here as a provisional estimate.
  // (This mirrors waitingCells / CellLifeGantt, which already read the confirmed anchor directly.)
  const plannedOffsetMs = breakoutOffsetH(carousel, cellNumber) * 3_600_000;
  const confirmed = cell.first_use_started_at;
  const anchor = confirmed ?? cell.first_use_planned_start_at;
  const breakoutMs = anchor ? new Date(anchor).getTime() + (confirmed ? 0 : plannedOffsetMs) : null;
  const breakoutAt = breakoutMs !== null ? new Date(breakoutMs).toISOString() : null;
  const expiryAt = breakoutMs !== null ? new Date(breakoutMs + CELL_LIFETIME_H * 3_600_000).toISOString() : null;
  // Each committed use's breakout instant. A cancelled use (a permanent Stop marker) never ran,
  // so it's excluded, matching how the backend's uses_remaining counts capacity. Computed for
  // terminal cells too, not just open ones: a cell can be marked exhausted the moment its whole
  // week is *scheduled*, before those uses have physically broken out (a tray disposed at the
  // max-uses dial, or the last of a staggered breakout ladder), and the live "now" view needs
  // these instants to tell which of a terminal cell's uses have actually happened yet. As above:
  // a *started* use's breakout_anchor_at is its real, already-staggered started_at (use as-is);
  // a still-planned use quotes the shared plate planned_start_at, so only that provisional
  // estimate gets the stagger applied here.
  const useBreakoutsMs = cell.uses
    .filter((u) => u.status !== "cancelled" && u.breakout_anchor_at !== null)
    .map((u) => new Date(u.breakout_anchor_at as string).getTime() + (u.run_started ? 0 : plannedOffsetMs))
    .sort((a, b) => a - b);
  return {
    cellId: cell.id,
    code: cell.code,
    cellNumber,
    // A terminal/stopped cell offers no usable uses even if it physically has capacity left
    // (e.g. a tray disposed early at the max-uses dial) - show what can still be run: 0.
    usesRemaining: cell.status === "open" ? cell.uses_remaining : 0,
    maxUses: cell.max_uses,
    useBreakoutsMs,
    status: cell.status,
    breakoutAt,
    expiryAt,
    provisional: expiryAt !== null && !cell.first_use_started_at,
  };
}

/**
 * The cell/tray map for every instrument, anchored to the END of the viewed week. For each
 * instrument's two carousel positions it picks the physical tray resident on the week's LAST
 * visible day (its tenure [founding, eviction) spans that day) and projects each of that tray's
 * 4 cells to their scheduled-forward state (uses remaining, 108h expiry, urgency) - all read
 * straight from the already-fetched CellOut, whose totals already count planned uses.
 *
 * Anchoring to the week's END (not its first day) is what makes the panel match its own caption:
 * the slot's cells are shaded, and the pill reads, "state by end of <last weekday>". When a
 * carousel position turns over within the week - the resident tray ages out of its 108h window
 * and a fresh tray is loaded into the same position - the departed predecessor is fully expired
 * by week's end and is no longer physically on the instrument, so it is dropped; the slot shows
 * the SUCCESSOR that's actually resident by Friday. (Picking the week's-start tray instead left
 * an expired, already-swapped-out tray pinned in a slot captioned "by end of week" - the bug
 * this anchoring fixes.)
 *
 * A tray whose 4 cells have ALL gone terminal (used up / expired / retired) is deliberately NOT
 * dropped when it is still the position's end-of-week resident (no successor has evicted it) -
 * it stays in its carousel slot, rendered fully depleted (its cells project to "spent"/"expired"
 * and read 0 uses), because the physical tray is still sitting in the bay until an operator swaps
 * it. This is the one place the overview parts ways with the grid's ghost logic (which treats a
 * fully-terminal tray as gone, freeing its wells to load onto) - hence no `vacatedTrayIds` here:
 * only a *successor* tray founded in the same carousel position (via `trayEvictionDates`) evicts
 * the depleted one from the slot.
 *
 * `allCells` should be the wide open+terminal+stopped universe (SchedulePage's three cell
 * queries), and `trayFoundingDates`/`trayEvictionDates` the same maps SchedulePage already
 * derives from it - reused here so residency agrees exactly with the grid's eviction logic.
 */
export function computeInstrumentTrayMaps(
  allCells: CellOut[],
  days: string[],
  trayFoundingDates: Map<number, string>,
  trayEvictionDates: Map<number, string>,
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

  // The week's LAST visible weekday anchors residency (and the panel's caption/shading). An
  // empty window (shouldn't happen in practice) falls back to today so the map still resolves.
  const lastDay = days[days.length - 1] ?? days[0] ?? todayIsoUTC();
  const out = new Map<string, InstrumentTrayMap>();

  for (const [serial, byTray] of byInstrument) {
    const carousel: [TrayView | null, TrayView | null] = [null, null];

    // Per carousel position, the tray resident on the week's LAST day (keeping the latest-founded
    // on the rare tie, so a mid-week successor beats the predecessor it evicted).
    type TrayCand = { trayId: number; founding: string | null; siblings: CellOut[] };
    const endResident: [TrayCand | null, TrayCand | null] = [null, null];

    for (const [trayId, siblings] of byTray) {
      // A fully-terminal tray (every sibling used up / expired / retired) is intentionally kept,
      // not skipped: it stays a depleted resident until a successor evicts it (see the header
      // docstring). Residency below is decided purely by founding/eviction tenure.

      // All 4 siblings share one carousel position; read it off the first with a known well.
      const wellCell = siblings.find((c) => c.current_well);
      const raw = carouselOf(wellCell?.current_well ?? null);
      if (raw < 0) continue;
      const pos = raw as 0 | 1;

      const founding = trayFoundingDates.get(trayId) ?? null;
      const eviction = trayEvictionDates.get(trayId);

      // Resident on the last visible day? Tenure [founding, eviction) must span it. A never-used
      // tray (no founding anchor) is physically loaded already, so treat it as resident. A tray
      // founded further out than this week is not yet on the instrument; one already evicted by a
      // successor before week's end has physically left, so both are excluded.
      const foundedByEnd = founding === null || founding <= lastDay;
      const notYetEvicted = eviction === undefined || lastDay < eviction;
      if (!foundedByEnd || !notYetEvicted) continue;

      // On the rare tie (shouldn't happen - one tray per position at a time), keep the
      // latest-founded so a successor beats its predecessor.
      const current = endResident[pos];
      if (current !== null && (founding ?? "") <= (current.founding ?? "")) continue;
      endResident[pos] = { trayId, founding, siblings };
    }

    for (const pos of [0, 1] as const) {
      const resident = endResident[pos];
      if (!resident) continue;
      const positions = [...resident.siblings]
        .sort((a, b) => (a.tray_position ?? 0) - (b.tray_position ?? 0))
        .map((c) => positionView(c, pos));
      carousel[pos] = { trayId: resident.trayId, carousel: pos, positions };
    }

    out.set(serial, { asOfDate: days[0] ?? null, weekEndDate: days[days.length - 1] ?? null, carousel });
  }

  return out;
}

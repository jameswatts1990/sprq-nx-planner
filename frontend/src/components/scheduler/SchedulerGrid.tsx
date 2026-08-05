import type { KeyboardEvent, MouseEvent } from "react";

import type { RunOut, StageOut } from "@/types/schedule";
import {
  formatShortDateUTC,
  isWeekendUTC,
  parseDateOnly,
  shortWeekdayUTC,
  todayIsoUTC,
} from "@/utils/calendarDates";

import { resolveCell } from "./groupCyclesByInstrumentAndDay";
import { SchedulerGridRow } from "./SchedulerGridRow";
import type { InstrumentTrayMap } from "./instrumentTrayMaps";
import styles from "./SchedulerGrid.module.css";
import type { Coord, GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import type { CellGhost } from "./waitingCells";

// Stable empty references for instruments with nothing to show, so the memoized
// SchedulerGridRow doesn't see a new object identity on every render.
const EMPTY_CYCLES_BY_DATE: Map<string, RunOut> = new Map();
const EMPTY_WAITING_BY_DATE: Map<string, CellGhost[]> = new Map();
const EMPTY_BLOCKED_BY_DATE: Map<string, Set<string>> = new Map();

export interface SchedulerGridProps {
  instrumentSerials: string[];
  /** Per-instrument display name + maintenance-down date, keyed by serial. Drives the row's
   * name/serial label and the greyed, non-selectable down day-columns. */
  instrumentMeta: Map<string, { name: string | null; downFrom: string | null }>;
  /** The 5 weekday (Mon-Fri) YYYY-MM-DD strings for the current window. */
  days: string[];
  /** Runs pre-grouped by (instrument_serial, load_date) - computed once in SchedulePage
   * and passed down so the grouping isn't rebuilt on every grid render. */
  grouped: Map<string, Map<string, RunOut>>;
  selection: GridSelection;
  placingSlotKey: string | null;
  /** The slot a manual drop was just rejected on for a barcode clash - see
   * useScheduleActions' clashSlotKey. */
  clashSlotKey: string | null;
  onOpenDetail: (stage: StageOut, run: RunOut) => void;
  onOpenCell: (stage: StageOut, run: RunOut) => void;
  slotSelection: SlotSelection;
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  onDragSelectStart: (stage: StageOut, coord: { r: number; c: number }) => void;
  waitingGrouped: Map<string, Map<string, CellGhost[]>>;
  /** Wells permanently blocked by a stopped cell, keyed by instrument then day (see
   * waitingCells.computeBlockedWellsByInstrumentAndDay - day-aware because a later tray
   * reuses the same well once the stopped cell's tray leaves). */
  blockedGrouped: Map<string, Map<string, Set<string>>>;
  /** Projected on-instrument tray map per instrument serial (see
   * instrumentTrayMap.computeInstrumentTrayMaps), shown beneath each serial. */
  trayMaps: Map<string, InstrumentTrayMap>;
  /** "Recalculate" next to an instrument's name - opens the confirm modal for that serial. */
  onRecalculate: (serial: string) => void;
}

function SchedulerDayHeader({
  date,
  colIndex,
  selectable,
  dayStatus,
  onSelectColumn,
}: {
  date: string;
  colIndex: number;
  selectable: boolean;
  /** Where this day sits relative to today - drives the header background colour
   * (grey = past, rose = today, white = future) so the week reads at a glance. */
  dayStatus: "past" | "today" | "future";
  onSelectColumn: (colIndex: number, ctrl: boolean) => void;
}) {
  const d = parseDateOnly(date);
  const weekend = isWeekendUTC(d);

  function onClick(e: MouseEvent<HTMLTableCellElement>) {
    if (selectable) onSelectColumn(colIndex, e.ctrlKey || e.metaKey);
  }
  function onKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (selectable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onSelectColumn(colIndex, e.ctrlKey || e.metaKey);
    }
  }

  const statusClass =
    dayStatus === "past" ? styles.pastTh : dayStatus === "today" ? styles.todayTh : undefined;

  return (
    <th
      className={[
        styles.dayTh,
        weekend ? styles.weekendTh : statusClass,
        selectable ? styles.headerSelectable : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={selectable ? onClick : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      title={selectable ? "Select all open instruments for this day (Ctrl/Cmd-click to add to the current selection)" : undefined}
    >
      {weekend ? (
        <div className={styles.dn}>{shortWeekdayUTC(d)}</div>
      ) : (
        <div className={styles.dn}>
          {shortWeekdayUTC(d)} <span className={styles.dd}>{formatShortDateUTC(d)}</span>
        </div>
      )}
    </th>
  );
}

/** Table shell for the weekly scheduler: sticky day-header row, sticky-left instrument
 * column, one SchedulerGridRow per instrument. Mirrors the old CalendarGrid structure. */
export function SchedulerGrid({
  instrumentSerials,
  instrumentMeta,
  days,
  grouped,
  selection,
  placingSlotKey,
  clashSlotKey,
  onOpenDetail,
  onOpenCell,
  slotSelection,
  onExtendSelect,
  onDragSelectStart,
  waitingGrouped,
  blockedGrouped,
  trayMaps,
  onRecalculate,
}: SchedulerGridProps) {
  function isDown(serial: string, date: string): boolean {
    const downFrom = instrumentMeta.get(serial)?.downFrom ?? null;
    return downFrom !== null && date >= downFrom;
  }

  // Same open-cell computation SchedulerGridRow uses (via the shared resolveCell) - a day
  // with no run of its own is still closed if an earlier run's continuation still occupies it,
  // or if the instrument is down for maintenance from this date (so the column selection
  // helpers below never sweep a greyed down cell into a selection).
  function isDateOpen(serial: string, date: string): boolean {
    return !isDown(serial, date) && resolveCell(grouped.get(serial), date).open;
  }

  // Select every open (non-weekend, run-free) cell in a day's column, across all
  // instruments - the header equivalent of shift-selecting a rectangle for a whole day.
  // Ctrl/cmd-click unions this into the existing selection instead of replacing it, so
  // several days can be built up one header-click at a time.
  function onSelectColumn(colIndex: number, ctrl: boolean) {
    const date = days[colIndex];
    const coords: Coord[] = [];
    instrumentSerials.forEach((serial, rowIndex) => {
      if (isDateOpen(serial, date)) coords.push({ r: rowIndex, c: colIndex });
    });
    selection.selectMany(coords, ctrl);
  }

  // Corner "Instrument" header: select every open cell across every instrument and day
  // currently in view - the spreadsheet "select all" corner.
  function onSelectAll() {
    const coords: Coord[] = [];
    instrumentSerials.forEach((serial, rowIndex) => {
      days.forEach((date, colIndex) => {
        if (isWeekendUTC(parseDateOnly(date))) return;
        if (isDateOpen(serial, date)) coords.push({ r: rowIndex, c: colIndex });
      });
    });
    selection.selectMany(coords);
  }
  function onSelectAllKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectAll();
    }
  }

  // ISO date strings sort lexically, so a plain compare against today's date places each
  // column in the past / today / future without any extra date arithmetic.
  const today = todayIsoUTC();

  return (
    <div className={styles.gridScroll}>
      <table className={styles.grid}>
        <colgroup>
          <col className={styles.cornerCol} />
          {days.map((date) => (
            <col key={date} className={isWeekendUTC(parseDateOnly(date)) ? styles.weekendCol : styles.dayCol} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              className={`${styles.corner} ${styles.headerSelectable}`}
              onClick={onSelectAll}
              onKeyDown={onSelectAllKeyDown}
              role="button"
              tabIndex={0}
              title="Select every open cell for every instrument and day"
            >
              <div className={styles.ml}>Instrument</div>
            </th>
            {days.map((date, colIndex) => (
              <SchedulerDayHeader
                key={date}
                date={date}
                colIndex={colIndex}
                selectable={!isWeekendUTC(parseDateOnly(date))}
                dayStatus={date < today ? "past" : date === today ? "today" : "future"}
                onSelectColumn={onSelectColumn}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {instrumentSerials.map((serial, rowIndex) => (
            <SchedulerGridRow
              key={serial}
              serial={serial}
              name={instrumentMeta.get(serial)?.name ?? null}
              downFrom={instrumentMeta.get(serial)?.downFrom ?? null}
              rowIndex={rowIndex}
              days={days}
              cyclesByDate={grouped.get(serial) ?? EMPTY_CYCLES_BY_DATE}
              selection={selection}
              placingSlotKey={placingSlotKey}
              clashSlotKey={clashSlotKey}
              onOpenDetail={onOpenDetail}
              onOpenCell={onOpenCell}
              slotSelection={slotSelection}
              onExtendSelect={onExtendSelect}
              onDragSelectStart={onDragSelectStart}
              waitingCellsByDate={waitingGrouped.get(serial) ?? EMPTY_WAITING_BY_DATE}
              blockedWellsByDate={blockedGrouped.get(serial) ?? EMPTY_BLOCKED_BY_DATE}
              trayMap={trayMaps.get(serial)}
              onRecalculate={onRecalculate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

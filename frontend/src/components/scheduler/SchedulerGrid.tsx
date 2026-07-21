import type { KeyboardEvent, MouseEvent } from "react";

import type { CycleOut, StageOut } from "@/types/schedule";
import {
  formatShortDateUTC,
  isWeekendUTC,
  parseDateOnly,
  shortWeekdayUTC,
} from "@/utils/calendarDates";

import { findCarryOverLock, groupCyclesByInstrumentAndDay, isCellOpen } from "./groupCyclesByInstrumentAndDay";
import { SchedulerGridRow } from "./SchedulerGridRow";
import styles from "./SchedulerGrid.module.css";
import type { Coord, GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import type { CellGhost } from "./waitingCells";

// Stable empty-set reference for instruments with no blocked wells, so SchedulerGridRow
// doesn't see a new object identity on every render.
const EMPTY_BLOCKED_WELLS: Set<string> = new Set();

export interface SchedulerGridProps {
  instrumentSerials: string[];
  /** The 5 weekday (Mon-Fri) YYYY-MM-DD strings for the current window. */
  days: string[];
  cycles: CycleOut[];
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, cycle: CycleOut) => void;
  slotSelection: SlotSelection;
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  waitingGrouped: Map<string, Map<string, CellGhost[]>>;
  /** Wells permanently blocked by a stopped cell, keyed by instrument (see waitingCells.
   * groupBlockedWellsByInstrument). */
  blockedWellsByInstrument: Map<string, Set<string>>;
  onOpenGhost: (ghost: CellGhost) => void;
}

function SchedulerDayHeader({
  date,
  colIndex,
  selectable,
  onSelectColumn,
}: {
  date: string;
  colIndex: number;
  selectable: boolean;
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

  return (
    <th
      className={
        weekend
          ? `${styles.dayTh} ${styles.weekendTh}`
          : selectable
            ? `${styles.dayTh} ${styles.headerSelectable}`
            : styles.dayTh
      }
      onClick={selectable ? onClick : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      title={selectable ? "Select all open instruments for this day (Ctrl/Cmd-click to add to the current selection)" : undefined}
    >
      <div className={styles.dn}>{shortWeekdayUTC(d)}</div>
      {!weekend && <div className={styles.dd}>{formatShortDateUTC(d)}</div>}
    </th>
  );
}

/** Table shell for the weekly scheduler: sticky day-header row, sticky-left instrument
 * column, one SchedulerGridRow per instrument. Mirrors the old CalendarGrid structure. */
export function SchedulerGrid({
  instrumentSerials,
  days,
  cycles,
  selection,
  placingSlotKey,
  onOpenDetail,
  slotSelection,
  onExtendSelect,
  waitingGrouped,
  blockedWellsByInstrument,
  onOpenGhost,
}: SchedulerGridProps) {
  const grouped = groupCyclesByInstrumentAndDay(cycles);

  // Mirrors SchedulerGridRow's own selectable computation - a day with no cycle of its
  // own is still closed if an earlier run's lock carries over onto it.
  function isDateOpen(serial: string, date: string): boolean {
    const byDate = grouped.get(serial);
    const cycle = byDate?.get(date);
    return isCellOpen(cycle, cycle || !byDate ? undefined : findCarryOverLock(byDate, date));
  }

  // Select every open (non-weekend, cycle-free) cell in a day's column, across all
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
              rowIndex={rowIndex}
              days={days}
              cyclesByDate={grouped.get(serial) ?? new Map()}
              selection={selection}
              placingSlotKey={placingSlotKey}
              onOpenDetail={onOpenDetail}
              slotSelection={slotSelection}
              onExtendSelect={onExtendSelect}
              waitingCellsByDate={waitingGrouped.get(serial) ?? new Map()}
              blockedWells={blockedWellsByInstrument.get(serial) ?? EMPTY_BLOCKED_WELLS}
              onOpenGhost={onOpenGhost}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

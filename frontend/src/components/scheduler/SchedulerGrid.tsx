import type { KeyboardEvent } from "react";

import type { CycleOut, StageOut } from "@/types/schedule";
import {
  formatShortDateUTC,
  isWeekendUTC,
  parseDateOnly,
  shortWeekdayUTC,
} from "@/utils/calendarDates";

import { groupCyclesByInstrumentAndDay, isCellOpen } from "./groupCyclesByInstrumentAndDay";
import { SchedulerGridRow } from "./SchedulerGridRow";
import styles from "./SchedulerGrid.module.css";
import type { Coord, GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import type { CellGhost } from "./waitingCells";

export interface SchedulerGridProps {
  instrumentSerials: string[];
  /** 14 YYYY-MM-DD strings for the current window. */
  days: string[];
  cycles: CycleOut[];
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, locked: boolean, instrumentSerial: string) => void;
  slotSelection: SlotSelection;
  activeDragInstrument: string | null;
  waitingGrouped: Map<string, Map<string, CellGhost[]>>;
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
  onSelectColumn: (colIndex: number) => void;
}) {
  const d = parseDateOnly(date);
  const weekend = isWeekendUTC(d);

  function onKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (selectable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onSelectColumn(colIndex);
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
      onClick={selectable ? () => onSelectColumn(colIndex) : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      title={selectable ? "Select all open instruments for this day" : undefined}
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
  activeDragInstrument,
  waitingGrouped,
  onOpenGhost,
}: SchedulerGridProps) {
  const grouped = groupCyclesByInstrumentAndDay(cycles);

  // Select every open (non-weekend, cycle-free) cell in a day's column, across all
  // instruments - the header equivalent of shift-selecting a rectangle for a whole day.
  function onSelectColumn(colIndex: number) {
    const date = days[colIndex];
    const coords: Coord[] = [];
    instrumentSerials.forEach((serial, rowIndex) => {
      if (isCellOpen(grouped.get(serial)?.get(date))) coords.push({ r: rowIndex, c: colIndex });
    });
    selection.selectMany(coords);
  }

  return (
    <div className={styles.gridScroll}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th className={styles.corner}>
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
              activeDragInstrument={activeDragInstrument}
              waitingCellsByDate={waitingGrouped.get(serial) ?? new Map()}
              onOpenGhost={onOpenGhost}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

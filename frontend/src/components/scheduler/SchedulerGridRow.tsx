import type { KeyboardEvent } from "react";

import type { CycleOut, StageOut } from "@/types/schedule";
import { isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { findCarryOverLock, isCellOpen } from "./groupCyclesByInstrumentAndDay";
import type { GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import { SchedulerDayCell } from "./SchedulerDayCell";
import styles from "./SchedulerGrid.module.css";
import type { CellGhost } from "./waitingCells";

export interface SchedulerGridRowProps {
  serial: string;
  rowIndex: number;
  days: string[];
  cyclesByDate: Map<string, CycleOut>;
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, locked: boolean, instrumentSerial: string) => void;
  slotSelection: SlotSelection;
  activeDragInstrument: string | null;
  waitingCellsByDate: Map<string, CellGhost[]>;
  onOpenGhost: (ghost: CellGhost) => void;
}

/** One instrument row: sticky-left <th> serial, then one SchedulerDayCell per day.
 * Mirrors the old InstrumentRow. */
export function SchedulerGridRow({
  serial,
  rowIndex,
  days,
  cyclesByDate,
  selection,
  placingSlotKey,
  onOpenDetail,
  slotSelection,
  activeDragInstrument,
  waitingCellsByDate,
  onOpenGhost,
}: SchedulerGridRowProps) {
  const selectableCols: number[] = [];
  days.forEach((date, colIndex) => {
    const weekend = isWeekendUTC(parseDateOnly(date));
    if (!weekend && isCellOpen(cyclesByDate.get(date))) selectableCols.push(colIndex);
  });

  function onRowHeaderSelect() {
    if (selectableCols.length === 0) return;
    selection.selectMany(selectableCols.map((c) => ({ r: rowIndex, c })));
  }
  function onRowHeaderKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (selectableCols.length > 0 && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowHeaderSelect();
    }
  }

  return (
    <tr>
      <th
        className={selectableCols.length > 0 ? `${styles.machTh} ${styles.headerSelectable}` : styles.machTh}
        onClick={selectableCols.length > 0 ? onRowHeaderSelect : undefined}
        onKeyDown={selectableCols.length > 0 ? onRowHeaderKeyDown : undefined}
        role={selectableCols.length > 0 ? "button" : undefined}
        tabIndex={selectableCols.length > 0 ? 0 : undefined}
        title={selectableCols.length > 0 ? "Select all open days this week for this instrument" : undefined}
      >
        <div className={styles.ml}>Revio</div>
        <div className={styles.mid}>{serial}</div>
      </th>
      {days.map((date, colIndex) => {
        const weekend = isWeekendUTC(parseDateOnly(date));
        const cycle = cyclesByDate.get(date);
        const selectable = !weekend && isCellOpen(cycle);
        const selected = selectable && selection.isSelected(rowIndex, colIndex);
        const carryOverLock = cycle ? undefined : findCarryOverLock(cyclesByDate, date);
        return (
          <SchedulerDayCell
            key={date}
            instrumentSerial={serial}
            runDate={date}
            rowIndex={rowIndex}
            colIndex={colIndex}
            weekend={weekend}
            cycle={cycle}
            carryOverLock={carryOverLock}
            selectable={selectable}
            selected={selected}
            placingSlotKey={placingSlotKey}
            onSelect={selection.handleCellClick}
            onOpenDetail={onOpenDetail}
            slotSelection={slotSelection}
            activeDragInstrument={activeDragInstrument}
            waitingCells={waitingCellsByDate.get(date) ?? []}
            onOpenGhost={onOpenGhost}
          />
        );
      })}
    </tr>
  );
}

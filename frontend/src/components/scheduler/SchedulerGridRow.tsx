import type { KeyboardEvent, MouseEvent } from "react";

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
  onOpenDetail: (stage: StageOut, cycle: CycleOut) => void;
  slotSelection: SlotSelection;
  activeDragInstrument: string | null;
  waitingCellsByDate: Map<string, CellGhost[]>;
  /** Wells on this instrument permanently blocked by a stopped cell. */
  blockedWells: Set<string>;
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
  blockedWells,
  onOpenGhost,
}: SchedulerGridRowProps) {
  const selectableCols: number[] = [];
  days.forEach((date, colIndex) => {
    const weekend = isWeekendUTC(parseDateOnly(date));
    const cycle = cyclesByDate.get(date);
    if (!weekend && isCellOpen(cycle, cycle ? undefined : findCarryOverLock(cyclesByDate, date))) selectableCols.push(colIndex);
  });

  // Ctrl/cmd-click unions this instrument's row into the existing selection instead of
  // replacing it, so several instruments can be built up one header-click at a time.
  function onRowHeaderSelect(ctrl: boolean) {
    if (selectableCols.length === 0) return;
    selection.selectMany(
      selectableCols.map((c) => ({ r: rowIndex, c })),
      ctrl,
    );
  }
  function onRowHeaderClick(e: MouseEvent<HTMLTableCellElement>) {
    onRowHeaderSelect(e.ctrlKey || e.metaKey);
  }
  function onRowHeaderKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (selectableCols.length > 0 && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowHeaderSelect(e.ctrlKey || e.metaKey);
    }
  }

  return (
    <tr>
      <th
        className={selectableCols.length > 0 ? `${styles.machTh} ${styles.headerSelectable}` : styles.machTh}
        onClick={selectableCols.length > 0 ? onRowHeaderClick : undefined}
        onKeyDown={selectableCols.length > 0 ? onRowHeaderKeyDown : undefined}
        role={selectableCols.length > 0 ? "button" : undefined}
        tabIndex={selectableCols.length > 0 ? 0 : undefined}
        title={
          selectableCols.length > 0
            ? "Select all open days this week for this instrument (Ctrl/Cmd-click to add to the current selection)"
            : undefined
        }
      >
        <div className={styles.ml}>Revio</div>
        <div className={styles.mid}>{serial}</div>
      </th>
      {days.map((date, colIndex) => {
        const weekend = isWeekendUTC(parseDateOnly(date));
        const cycle = cyclesByDate.get(date);
        const carryOverLock = cycle ? undefined : findCarryOverLock(cyclesByDate, date);
        const selectable = !weekend && isCellOpen(cycle, carryOverLock);
        const selected = selectable && selection.isSelected(rowIndex, colIndex);
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
            blockedWells={blockedWells}
            onOpenGhost={onOpenGhost}
          />
        );
      })}
    </tr>
  );
}

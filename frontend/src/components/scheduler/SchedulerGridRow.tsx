import { memo, type KeyboardEvent, type MouseEvent } from "react";

import type { CycleOut, StageOut } from "@/types/schedule";
import { isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { findCarryOverLock, isCellOpen } from "./groupCyclesByInstrumentAndDay";
import type { GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import { SchedulerDayCell } from "./SchedulerDayCell";
import styles from "./SchedulerGrid.module.css";
import type { CellGhost, TrayDisposalWarning } from "./waitingCells";

// Stable empty references so a day with nothing to show doesn't hand SchedulerDayCell a new
// object identity on every render.
const EMPTY_GHOSTS: CellGhost[] = [];
const EMPTY_BLOCKED_WELLS: Set<string> = new Set();
const EMPTY_DISPOSAL: TrayDisposalWarning[] = [];

export interface SchedulerGridRowProps {
  serial: string;
  rowIndex: number;
  days: string[];
  cyclesByDate: Map<string, CycleOut>;
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, cycle: CycleOut) => void;
  slotSelection: SlotSelection;
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  onDragSelectStart: (stage: StageOut, coord: { r: number; c: number }) => void;
  waitingCellsByDate: Map<string, CellGhost[]>;
  /** Wells on this instrument permanently blocked by a stopped cell, per day. */
  blockedWellsByDate: Map<string, Set<string>>;
  /** Tray-disposal warnings on this instrument, keyed by the tray's last scheduled-use day. */
  disposalByDate: Map<string, TrayDisposalWarning[]>;
  onOpenGhost: (ghost: CellGhost) => void;
}

/** One instrument row: sticky-left <th> serial, then one SchedulerDayCell per day.
 * Mirrors the old InstrumentRow. memo'd so a page-level state change that leaves this row's
 * props untouched (a popover opening, the 60s cycles poll returning identical data) doesn't
 * re-render the whole row - relies on SchedulePage passing stable (useCallback/useMemo)
 * handlers and grouping. */
export const SchedulerGridRow = memo(function SchedulerGridRow({
  serial,
  rowIndex,
  days,
  cyclesByDate,
  selection,
  placingSlotKey,
  onOpenDetail,
  slotSelection,
  onExtendSelect,
  onDragSelectStart,
  waitingCellsByDate,
  blockedWellsByDate,
  disposalByDate,
  onOpenGhost,
}: SchedulerGridRowProps) {
  // Everything each day-cell needs, derived once per day. carryOverLock is the only costly
  // bit (it scans cyclesByDate) and used to be computed twice per day - here it's computed
  // a single time, and skipped entirely for weekend/has-cycle days that never consult it.
  const dayInfos = days.map((date, colIndex) => {
    const weekend = isWeekendUTC(parseDateOnly(date));
    const cycle = cyclesByDate.get(date);
    const carryOverLock = weekend || cycle ? undefined : findCarryOverLock(cyclesByDate, date);
    const selectable = !weekend && isCellOpen(cycle, carryOverLock);
    return { date, colIndex, weekend, cycle, carryOverLock, selectable };
  });
  const selectableCols = dayInfos.filter((d) => d.selectable).map((d) => d.colIndex);

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
      {dayInfos.map(({ date, colIndex, weekend, cycle, carryOverLock, selectable }) => {
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
            onExtendSelect={onExtendSelect}
            onDragSelectStart={onDragSelectStart}
            waitingCells={waitingCellsByDate.get(date) ?? EMPTY_GHOSTS}
            blockedWells={blockedWellsByDate.get(date) ?? EMPTY_BLOCKED_WELLS}
            disposalWarnings={disposalByDate.get(date) ?? EMPTY_DISPOSAL}
            onOpenGhost={onOpenGhost}
          />
        );
      })}
    </tr>
  );
});

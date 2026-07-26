import { memo, type KeyboardEvent, type MouseEvent } from "react";

import type { RunOut, StageOut } from "@/types/schedule";
import { isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { resolveCell } from "./groupCyclesByInstrumentAndDay";
import type { GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import { SchedulerDayCell } from "./SchedulerDayCell";
import { InstrumentTrayMap } from "./InstrumentTrayMap";
import type { InstrumentTrayMap as InstrumentTrayMapData } from "./instrumentTrayMaps";
import styles from "./SchedulerGrid.module.css";
import type { CellGhost } from "./waitingCells";

// Stable empty references so a day with nothing to show doesn't hand SchedulerDayCell a new
// object identity on every render.
const EMPTY_GHOSTS: CellGhost[] = [];
const EMPTY_BLOCKED_WELLS: Set<string> = new Set();

export interface SchedulerGridRowProps {
  serial: string;
  /** Friendly instrument name shown as the row's primary label; falls back to the serial
   * when unset. The serial stays the row's identity key regardless. */
  name: string | null;
  /** ISO date (YYYY-MM-DD) the instrument went down for maintenance, or null when online.
   * Day-columns on/after this are greyed and non-selectable (see SchedulerDayCell's `down`). */
  downFrom: string | null;
  rowIndex: number;
  days: string[];
  cyclesByDate: Map<string, RunOut>;
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, run: RunOut) => void;
  onOpenCell: (stage: StageOut, run: RunOut) => void;
  slotSelection: SlotSelection;
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  onDragSelectStart: (stage: StageOut, coord: { r: number; c: number }) => void;
  waitingCellsByDate: Map<string, CellGhost[]>;
  /** Wells on this instrument permanently blocked by a stopped cell, per day. */
  blockedWellsByDate: Map<string, Set<string>>;
  /** Projected on-instrument tray map (as of the latest scheduled day this week), shown
   * beneath the serial. Undefined when the instrument has no tray-linked cells at all. */
  trayMap: InstrumentTrayMapData | undefined;
}

/** One instrument row: sticky-left <th> serial, then one SchedulerDayCell per day.
 * Mirrors the old InstrumentRow. memo'd so a page-level state change that leaves this row's
 * props untouched (a popover opening, the 60s cycles poll returning identical data) doesn't
 * re-render the whole row - relies on SchedulePage passing stable (useCallback/useMemo)
 * handlers and grouping. */
export const SchedulerGridRow = memo(function SchedulerGridRow({
  serial,
  name,
  downFrom,
  rowIndex,
  days,
  cyclesByDate,
  selection,
  placingSlotKey,
  onOpenDetail,
  onOpenCell,
  slotSelection,
  onExtendSelect,
  onDragSelectStart,
  waitingCellsByDate,
  blockedWellsByDate,
  trayMap,
}: SchedulerGridRowProps) {
  // Everything each day-cell needs, derived once per day. continuation is the only costly
  // bit (it scans cyclesByDate) and used to be computed twice per day - here it's computed
  // a single time, and skipped entirely for weekend/has-run days that never consult it.
  const dayInfos = days.map((date, colIndex) => {
    const weekend = isWeekendUTC(parseDateOnly(date));
    // Weekends are never open and never consult a continuation, so skip the costly scan.
    if (weekend) {
      return { date, colIndex, weekend, run: cyclesByDate.get(date), continuation: undefined, selectable: false, down: false };
    }
    // Down for maintenance from downFrom onward: the day is greyed and can't be selected or
    // take a new run (mirrors the backend guard in placement_service.get_or_create_run). ISO
    // date strings compare lexically, so a plain >= is the on-or-after-the-down-date test.
    const down = downFrom !== null && date >= downFrom;
    const { run, continuation, open } = resolveCell(cyclesByDate, date);
    return { date, colIndex, weekend, run, continuation, selectable: open && !down, down };
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
        <div className={styles.mid}>{name || serial}</div>
        {name && <div className={styles.serialSub}>{serial}</div>}
        <InstrumentTrayMap map={trayMap} />
      </th>
      {dayInfos.map(({ date, colIndex, weekend, run, continuation, selectable, down }) => {
        const selected = selectable && selection.isSelected(rowIndex, colIndex);
        return (
          <SchedulerDayCell
            key={date}
            instrumentSerial={serial}
            loadDate={date}
            rowIndex={rowIndex}
            colIndex={colIndex}
            weekend={weekend}
            down={down}
            run={run}
            continuation={continuation}
            selectable={selectable}
            selected={selected}
            placingSlotKey={placingSlotKey}
            onSelect={selection.handleCellClick}
            onOpenDetail={onOpenDetail}
            onOpenCell={onOpenCell}
            slotSelection={slotSelection}
            onExtendSelect={onExtendSelect}
            onDragSelectStart={onDragSelectStart}
            waitingCells={waitingCellsByDate.get(date) ?? EMPTY_GHOSTS}
            blockedWells={blockedWellsByDate.get(date) ?? EMPTY_BLOCKED_WELLS}
          />
        );
      })}
    </tr>
  );
});

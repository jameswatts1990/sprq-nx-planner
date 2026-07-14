import type { CycleOut, StageOut } from "@/types/schedule";
import { isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { findCarryOverLock } from "./groupCyclesByInstrumentAndDay";
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
  onOpenDetail: (stage: StageOut, locked: boolean) => void;
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
  return (
    <tr>
      <th className={styles.machTh}>
        <div className={styles.ml}>Revio</div>
        <div className={styles.mid}>{serial}</div>
      </th>
      {days.map((date, colIndex) => {
        const weekend = isWeekendUTC(parseDateOnly(date));
        const cycle = cyclesByDate.get(date);
        const selectable = !weekend && cycle === undefined;
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

import type { CycleOut, StageOut } from "@/types/schedule";
import { isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import type { GridSelection } from "./useGridSelection";
import type { SlotSelection } from "./useSlotSelection";
import { SchedulerDayCell } from "./SchedulerDayCell";
import styles from "./SchedulerGrid.module.css";

export interface SchedulerGridRowProps {
  serial: string;
  rowIndex: number;
  days: string[];
  cyclesByDate: Map<string, CycleOut>;
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, locked: boolean) => void;
  slotSelection: SlotSelection;
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
        return (
          <SchedulerDayCell
            key={date}
            instrumentSerial={serial}
            runDate={date}
            rowIndex={rowIndex}
            colIndex={colIndex}
            weekend={weekend}
            cycle={cycle}
            selectable={selectable}
            selected={selected}
            placingSlotKey={placingSlotKey}
            onSelect={selection.handleCellClick}
            onOpenDetail={onOpenDetail}
            slotSelection={slotSelection}
          />
        );
      })}
    </tr>
  );
}

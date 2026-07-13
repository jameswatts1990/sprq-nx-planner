import type { CycleOut, StageOut } from "@/types/schedule";
import {
  formatShortDateUTC,
  isWeekendUTC,
  parseDateOnly,
  shortWeekdayUTC,
} from "@/utils/calendarDates";

import { groupCyclesByInstrumentAndDay } from "./groupCyclesByInstrumentAndDay";
import { SchedulerGridRow } from "./SchedulerGridRow";
import styles from "./SchedulerGrid.module.css";
import type { GridSelection } from "./useGridSelection";

export interface SchedulerGridProps {
  instrumentSerials: string[];
  /** 14 YYYY-MM-DD strings for the current window. */
  days: string[];
  cycles: CycleOut[];
  selection: GridSelection;
  placingSlotKey: string | null;
  onOpenDetail: (stage: StageOut, locked: boolean) => void;
}

function SchedulerDayHeader({ date }: { date: string }) {
  const d = parseDateOnly(date);
  const weekend = isWeekendUTC(d);
  return (
    <th className={weekend ? `${styles.dayTh} ${styles.weekendTh}` : styles.dayTh}>
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
}: SchedulerGridProps) {
  const grouped = groupCyclesByInstrumentAndDay(cycles);

  return (
    <div className={styles.gridScroll}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th className={styles.corner}>
              <div className={styles.ml}>Instrument</div>
            </th>
            {days.map((date) => (
              <SchedulerDayHeader key={date} date={date} />
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
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

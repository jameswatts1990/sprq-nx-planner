import type { CycleOut } from "@/types/schedule";

import { CalendarDayHeader } from "./CalendarDayHeader";
import styles from "./CalendarGrid.module.css";
import { InstrumentRow } from "./InstrumentRow";

export interface CalendarGridProps {
  instrumentSerials: string[];
  startDate: string;
  days: number[];
  grouped: Map<string, Map<number, CycleOut[]>>;
}

/** Table shell: sticky header row of days, sticky-left column of instruments. */
export function CalendarGrid({ instrumentSerials, startDate, days, grouped }: CalendarGridProps) {
  return (
    <table className={styles.cal}>
      <thead>
        <tr>
          <th className={styles.corner}>
            <div className={styles.ml}>Instrument</div>
          </th>
          {days.map((dayIdx) => (
            <CalendarDayHeader key={dayIdx} dayIdx={dayIdx} startDate={startDate} />
          ))}
        </tr>
      </thead>
      <tbody>
        {instrumentSerials.map((serial) => (
          <InstrumentRow
            key={serial}
            serial={serial}
            days={days}
            startDate={startDate}
            cyclesByDay={grouped.get(serial) ?? new Map()}
          />
        ))}
      </tbody>
    </table>
  );
}

import type { CycleOut } from "@/types/schedule";

import { CalendarCell } from "./CalendarCell";
import styles from "./InstrumentRow.module.css";

export interface InstrumentRowProps {
  serial: string;
  days: number[];
  startDate: string;
  cyclesByDay: Map<number, CycleOut[]>;
}

/** One row per instrument serial; <th> with the serial, then one <td> per day. */
export function InstrumentRow({ serial, days, startDate, cyclesByDay }: InstrumentRowProps) {
  return (
    <tr>
      <th className={styles.machTh}>
        <div className={styles.ml}>Revio</div>
        <div className={styles.mid}>{serial}</div>
      </th>
      {days.map((dayIdx) => (
        <CalendarCell key={dayIdx} cycles={cyclesByDay.get(dayIdx) ?? []} dayIdx={dayIdx} startDate={startDate} />
      ))}
    </tr>
  );
}

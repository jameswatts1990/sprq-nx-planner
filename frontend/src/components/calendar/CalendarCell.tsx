import type { CycleOut } from "@/types/schedule";
import { addDaysUTC, isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { CycleBlock } from "./CycleBlock";
import styles from "./CalendarCell.module.css";

export interface CalendarCellProps {
  cycles: CycleOut[];
  dayIdx: number;
  startDate: string;
}

/** One <td>: 0..n CycleBlocks for this (instrument, day), or an empty diagonal-hatched
 * cell if none fall here. */
export function CalendarCell({ cycles, dayIdx, startDate }: CalendarCellProps) {
  const weekend = isWeekendUTC(addDaysUTC(parseDateOnly(startDate), dayIdx));
  const classes = [styles.cell];
  if (weekend) classes.push(styles.weekend);

  if (cycles.length === 0) {
    classes.push(styles.empty);
    return <td className={classes.join(" ")} />;
  }

  return (
    <td className={classes.join(" ")}>
      {cycles.map((cycle) => (
        <CycleBlock key={`${cycle.machine_idx}-${cycle.batch_idx}-${cycle.use_idx}-${cycle.day_idx}`} cycle={cycle} />
      ))}
    </td>
  );
}

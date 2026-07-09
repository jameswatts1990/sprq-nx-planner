import { addDaysUTC, formatShortDateUTC, isWeekendUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";

import styles from "./CalendarDayHeader.module.css";

export interface CalendarDayHeaderProps {
  dayIdx: number;
  startDate: string;
}

/** One <th> per day; label derived from startDate + day_idx, with weekend styling. */
export function CalendarDayHeader({ dayIdx, startDate }: CalendarDayHeaderProps) {
  const date = addDaysUTC(parseDateOnly(startDate), dayIdx);
  const weekend = isWeekendUTC(date);
  const classes = [styles.dayTh];
  if (weekend) classes.push(styles.weekend);

  return (
    <th className={classes.join(" ")}>
      <div className={styles.dn}>{shortWeekdayUTC(date)}</div>
      <div className={styles.dd}>
        day {dayIdx + 1} · {formatShortDateUTC(date)}
      </div>
    </th>
  );
}

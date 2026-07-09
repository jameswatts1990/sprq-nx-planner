import type { CycleOut } from "@/types/schedule";

import { CalendarClippedNotice } from "./CalendarClippedNotice";
import { CalendarEmptyState } from "./CalendarEmptyState";
import { CalendarGrid } from "./CalendarGrid";
import { groupCyclesByInstrumentAndDay } from "./groupCycles";
import styles from "./ScheduleCalendar.module.css";

export interface ScheduleCalendarProps {
  cycles: CycleOut[];
  instrumentSerials: string[];
  /** YYYY-MM-DD, the schedule's day_idx=0 date. */
  startDate: string;
  /** Mirrors the prototype's capDays; default 21. */
  dayCap?: number;
}

/** Renders CycleOut[] as the weekly calendar table (table.cal in the prototype). */
export function ScheduleCalendar({ cycles, instrumentSerials, startDate, dayCap = 21 }: ScheduleCalendarProps) {
  if (cycles.length === 0 || instrumentSerials.length === 0) {
    return <CalendarEmptyState />;
  }

  let minDay = Infinity;
  let maxDay = 0;
  for (const cycle of cycles) {
    minDay = Math.min(minDay, cycle.day_idx);
    maxDay = Math.max(maxDay, cycle.day_idx);
  }
  if (!Number.isFinite(minDay)) {
    minDay = 0;
    maxDay = 0;
  }

  const clipped = maxDay - minDay >= dayCap;
  const lastDay = clipped ? minDay + dayCap - 1 : maxDay;
  const days: number[] = [];
  for (let d = minDay; d <= lastDay; d++) days.push(d);

  const grouped = groupCyclesByInstrumentAndDay(cycles);

  return (
    <div className={styles.calScroll}>
      <CalendarGrid instrumentSerials={instrumentSerials} startDate={startDate} days={days} grouped={grouped} />
      {clipped && <CalendarClippedNotice dayCap={dayCap} />}
    </div>
  );
}

import { useRef } from "react";

import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/Button";

import type { SchedulerWindow } from "./useSchedulerWindow";

import styles from "./WeekNavigator.module.css";

/**
 * The Schedule toolbar's week control, in the Google Calendar / Outlook order: a labelled
 * Today, then ‹ week › as one joined unit. The week label doubles as the jump-to-date control -
 * clicking it opens the browser's own date picker (anchored under the label by the invisible
 * date input it sits over), and picking any day jumps to the Mon-Fri week containing it.
 */
export function WeekNavigator({ win, label }: { win: SchedulerWindow; label: string }) {
  const dateRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.nav}>
      <Button size="sm" variant="ghost" onClick={win.goToday} title="Jump back to this week">
        Today
      </Button>
      <div className={styles.week} role="group" aria-label="Week shown">
        <Button
          variant="ghost"
          icon
          className={styles.step}
          onClick={win.prev}
          aria-label="Previous week"
          title="Previous week"
        >
          <ChevronLeftIcon />
        </Button>
        <span className={styles.pick}>
          <Button
            variant="ghost"
            size="sm"
            className={styles.label}
            onClick={() => dateRef.current?.showPicker()}
            aria-haspopup="dialog"
            aria-label={`${label} - pick a date to jump to`}
            title="Jump to a date - pick any day to show its Mon-Fri week"
          >
            <CalendarIcon />
            {label}
          </Button>
          <input
            ref={dateRef}
            className={styles.dateInput}
            type="date"
            value={win.from}
            onChange={(e) => e.target.value && win.goToDate(e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
          />
        </span>
        <Button variant="ghost" icon className={styles.step} onClick={win.next} aria-label="Next week" title="Next week">
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}

import styles from "./CalendarClippedNotice.module.css";

export interface CalendarClippedNoticeProps {
  dayCap: number;
}

/** Shown when the cycles span more days than dayCap. */
export function CalendarClippedNotice({ dayCap }: CalendarClippedNoticeProps) {
  return (
    <div className={styles.notice}>
      Showing first {dayCap} days — schedule extends further. Add instruments or reduce max uses to compress.
    </div>
  );
}

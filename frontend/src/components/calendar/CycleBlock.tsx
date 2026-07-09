import type { CycleOut } from "@/types/schedule";
import { formatTimeOfDay } from "@/utils/calendarDates";
import { classForUseIndex } from "@/utils/useIndexClass";

import { StageRow } from "./StageRow";
import styles from "./CycleBlock.module.css";

export interface CycleBlockProps {
  cycle: CycleOut;
}

/** Colored header bar (magenta/blue/teal by use index) showing "Use N · k cells" plus
 * the time-of-day, with the cycle's stages listed below. */
export function CycleBlock({ cycle }: CycleBlockProps) {
  const useNumber = cycle.use_idx + 1;
  const useClass = classForUseIndex(useNumber);

  return (
    <div className={`${styles.cycle} ${styles[useClass]}`}>
      <div className={styles.head}>
        Use {useNumber} · {cycle.stages.length} cell{cycle.stages.length === 1 ? "" : "s"}
        <span className={styles.time}>{formatTimeOfDay(cycle.time_of_day_hours)}</span>
      </div>
      <div className={styles.body}>
        {cycle.stages.length === 0 ? (
          <div className={styles.emptyMsg}>No cells.</div>
        ) : (
          cycle.stages.map((stage) => <StageRow key={stage.well} stage={stage} useClass={useClass} />)
        )}
      </div>
    </div>
  );
}

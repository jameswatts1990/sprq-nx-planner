import type { CreditCaseState } from "@/types/credit";
import { getCreditStages } from "@/utils/creditCase";

import styles from "./CreditStageStrip.module.css";

/** Mini five-dot progress strip mirroring the full PacbioCreditTracker, so a credit case reads the
 * same at a glance in the QC worklist and the schedule's cell/slot popovers as it does expanded. */
export function CreditStageStrip({ credit }: { credit: CreditCaseState }) {
  const { stages, currentIndex } = getCreditStages(credit);
  return (
    <div
      className={styles.strip}
      title="Failure → PacBio report → Internal report → Credit confirmed → Credit received"
    >
      {stages.map((s, i) => {
        const state = s.done ? "done" : i === currentIndex ? "current" : "pending";
        return <span key={s.key} className={styles.dot} data-state={state} />;
      })}
    </div>
  );
}

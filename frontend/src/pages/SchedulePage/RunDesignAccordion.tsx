import { Accordion } from "@/components/ui/Accordion";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { NoteTone } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MaxUses, Objective, RunTimeHours } from "@/types/schedule";
import type { RunDesignState } from "@/types/schedulerGrid";

import styles from "./RunDesignAccordion.module.css";

export interface RunDesignAccordionProps {
  runDesign: RunDesignState;
  onChange: (next: RunDesignState) => void;
  /** Number of empty cells currently range-selected in the grid. */
  selectedCount: number;
  onAutoSchedule: () => void;
  autoFilling: boolean;
  /** Number of placed, unlocked samples in the currently-viewed week. */
  weekPlannedCount: number;
  /** Opens the "are you sure" confirmation - the actual clear happens after confirming. */
  onRequestClearSchedule: () => void;
  note: { tone: NoteTone; icon: string; text: string } | null;
}

const MAX_USES_OPTIONS = [
  { value: 1 as MaxUses, label: "1×" },
  { value: 2 as MaxUses, label: "2×" },
  { value: 3 as MaxUses, label: "3×" },
];
const RUN_TIME_OPTIONS = [
  { value: 12 as RunTimeHours, label: "12 h" },
  { value: 24 as RunTimeHours, label: "24 h" },
  { value: 30 as RunTimeHours, label: "30 h" },
];
const OBJECTIVE_OPTIONS = [
  { value: "fewest" as Objective, label: "Fewest cells", hint: "lowest cost" },
  { value: "balance" as Objective, label: "Balance", hint: "cost + speed" },
  { value: "fastest" as Objective, label: "Fastest", hint: "fewest days" },
];

/** Run Design dials that feed both single placements (place mutation) and batch
 * auto-fill. Instrument + start-date selection now happens spatially in the grid, so
 * those old fields are gone; auto-fill acts on the current grid range-selection. */
export function RunDesignAccordion({
  runDesign,
  onChange,
  selectedCount,
  onAutoSchedule,
  autoFilling,
  weekPlannedCount,
  onRequestClearSchedule,
  note,
}: RunDesignAccordionProps) {
  return (
    <Accordion
      title="Run design"
      badge={`${runDesign.max_uses}× · ${runDesign.run_time_hours} h · ${runDesign.objective}`}
    >
      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          Max uses per cell <span className={styles.hint}>auto-fill target depth</span>
        </div>
        <SegmentedControl
          ariaLabel="Max uses per cell"
          options={MAX_USES_OPTIONS}
          value={runDesign.max_uses}
          onChange={(v) => onChange({ ...runDesign, max_uses: v })}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Movie / run time</div>
        <SegmentedControl
          ariaLabel="Run time"
          options={RUN_TIME_OPTIONS}
          value={runDesign.run_time_hours}
          onChange={(v) => onChange({ ...runDesign, run_time_hours: v })}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Optimise for</div>
        <SegmentedControl
          ariaLabel="Optimisation objective"
          options={OBJECTIVE_OPTIONS}
          value={runDesign.objective}
          onChange={(v) => onChange({ ...runDesign, objective: v })}
        />
      </div>

      <div className={styles.autoBar}>
        <Button variant="primary" onClick={onAutoSchedule} disabled={selectedCount === 0 || autoFilling}>
          {autoFilling ? "Auto scheduling…" : `Auto schedule (${selectedCount} selected)`}
        </Button>
        <Button onClick={onRequestClearSchedule} disabled={weekPlannedCount === 0}>
          {`Clear schedule (${weekPlannedCount} planned)`}
        </Button>
        <span className={styles.autoHint}>
          Select empty cells, then auto-fill from the backlog. Clear schedule wipes this week&apos;s planned runs.
        </span>
      </div>

      {note && (
        <div className={styles.note}>
          <Note tone={note.tone} icon={note.icon}>
            {note.text}
          </Note>
        </div>
      )}
    </Accordion>
  );
}

import type { RunOut } from "@/types/schedule";
import { cellPositionLabel } from "@/utils/plateWell";
import { computeRunTimeline, PREP_H, type StageTiming } from "@/utils/stageTimings";
import { classForUseIndex } from "@/utils/useIndexClass";

import styles from "./RunStageGantt.module.css";

/** "HH:MM" (UTC) for an epoch-ms instant - matches the app's UTC clock everywhere else. */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function GanttRow({ t, spanH, current }: { t: StageTiming; spanH: number; current: boolean }) {
  const s = t.stage;
  // The physical cell's position label ("▣2"), same as the grid card's ticket stub.
  const cell = cellPositionLabel(s.tray_position, s.cell_home_well ?? s.well);
  const useClass = classForUseIndex(s.use_number);
  const pct = (h: number) => `${(h / spanH) * 100}%`;
  return (
    <div className={`${styles.row} ${current ? styles.current : ""}`}>
      <div className={styles.rowLabel} title={`Cell ${s.cell_ref} · Use ${s.use_number}`}>
        <span className={`${styles.stub} ${styles[useClass]}`}>{cell}</span>
        <span className={styles.sample}>{s.sample_external_id ?? "—"}</span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.prep}
          style={{ left: pct(t.prepStartH), width: pct(t.movieStartH - t.prepStartH) }}
          title={`Prep ~${PREP_H} h · from ${hhmm(t.prepStartMs)}`}
        />
        <div
          className={`${styles.movie} ${styles[useClass]}`}
          style={{ left: pct(t.movieStartH), width: pct(t.movieEndH - t.movieStartH) }}
          title={`Movie ${hhmm(t.movieStartMs)}–${hhmm(t.movieEndMs)} · ${s.run_time_hours} h`}
        >
          <span className={styles.movieLabel}>{s.run_time_hours} h</span>
        </div>
      </div>
      <div className={styles.rowTime}>
        {hhmm(t.movieStartMs)}–{hhmm(t.movieEndMs)}
      </div>
    </div>
  );
}

export interface RunStageGanttProps {
  run: RunOut;
  /** The placement whose row is highlighted (the popover's own slot). */
  currentCellUseId: number;
}

/**
 * A compact, estimated gantt of a run's wells: one row per loaded well, each a prep segment
 * then a movie segment on a shared "hours from load" axis, with the current placement's row
 * highlighted. Timings are the PacBio approximate-timing estimates (see utils/stageTimings) -
 * illustrative, not the instrument's exact schedule. Read-only; used in the slot-detail
 * popover so a scheduler can see where their sample sits in the run's sequencing flow.
 */
export function RunStageGantt({ run, currentCellUseId }: RunStageGanttProps) {
  const { spanH, timings } = computeRunTimeline(run);
  if (timings.length === 0 || spanH <= 0) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.caption}>
        <span className={styles.captionTitle}>Estimated stage times</span>
        <span className={styles.captionHint}>prep → movie, from load</span>
      </div>
      <div className={styles.rows}>
        {timings.map((t) => (
          <GanttRow key={t.stage.cell_use_id} t={t} spanH={spanH} current={t.stage.cell_use_id === currentCellUseId} />
        ))}
      </div>
      <div className={styles.axis}>
        <span>load</span>
        <span>+{Math.round(spanH)} h</span>
      </div>
    </div>
  );
}

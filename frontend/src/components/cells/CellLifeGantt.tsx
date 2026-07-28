import type { CellUseSummaryOut } from "@/types/cell";
import { classForUseIndex } from "@/utils/useIndexClass";
import { CELL_LIFETIME_H } from "@/utils/windowFade";

import styles from "./CellLifeGantt.module.css";

const HOUR_MS = 3_600_000;

export interface CellLifeGanttProps {
  /** The cell's chronological uses; those with a real breakout anchor are plotted. */
  uses: CellUseSummaryOut[];
  /** Hours into the cell's own 108h window (its "now"); null when there's no live window. */
  hoursElapsed: number | null;
}

/**
 * A one-cell timeline showing where the cell sits in its 108h life: each use plotted as a
 * breakout marker at the hour it broke out (measured from the first use's breakout, which is
 * what the 108h clock counts from), with a live "now" line and the 108h deadline. Uses the
 * Instruments-page Gantt's visual language (use-coloured marks, a green now line, an hours
 * axis) but plots honest breakout instants rather than run-duration bars, since the list-level
 * per-use record carries only the breakout anchor, not a run length. Renders nothing until at
 * least one use has an anchor to place.
 */
export function CellLifeGantt({ uses, hoursElapsed }: CellLifeGanttProps) {
  const anchored = uses
    .map((u, i) => ({ useNo: i + 1, ms: u.breakout_anchor_at ? Date.parse(u.breakout_anchor_at) : NaN }))
    .filter((x) => !Number.isNaN(x.ms));
  if (anchored.length === 0) return null;

  const first = Math.min(...anchored.map((a) => a.ms));
  const markers = anchored.map((a) => ({ useNo: a.useNo, offsetH: (a.ms - first) / HOUR_MS }));
  const maxOffset = markers.reduce((m, x) => Math.max(m, x.offsetH), 0);
  const spanH = Math.max(CELL_LIFETIME_H, maxOffset, hoursElapsed ?? 0) * 1.03;
  const pct = (h: number) => `${(h / spanH) * 100}%`;

  const ticks: number[] = [];
  for (let t = 0; t <= Math.floor(spanH / 24) * 24; t += 24) ticks.push(t);

  const over = hoursElapsed !== null && hoursElapsed > CELL_LIFETIME_H;
  const nowLabel =
    hoursElapsed === null
      ? "no live window"
      : over
        ? `now +${Math.round(hoursElapsed)} h · over`
        : `now +${Math.round(hoursElapsed)} h`;

  return (
    <div className={styles.wrap}>
      <div className={styles.cap}>
        <span className={styles.title}>Cell life</span>
        <span className={styles.sub}>{nowLabel}</span>
      </div>
      <div className={styles.track}>
        {markers.map((m, k) => (
          <div
            key={k}
            className={`${styles.marker} ${styles[classForUseIndex(m.useNo)]}`}
            style={{ left: pct(m.offsetH) }}
            title={`Use ${m.useNo} broke out at +${Math.round(m.offsetH)} h`}
          >
            <span className={styles.dot}>{Math.min(m.useNo, 3)}</span>
          </div>
        ))}
        <div className={styles.deadline} style={{ left: pct(CELL_LIFETIME_H) }} />
        <span className={styles.dcap} style={{ left: pct(CELL_LIFETIME_H) }}>
          108 h
        </span>
        {hoursElapsed !== null && hoursElapsed >= 0 && (
          <div className={styles.now} style={{ left: pct(hoursElapsed) }} />
        )}
      </div>
      <div className={styles.axis}>
        {ticks.map((t) => (
          <span key={t} className={styles.tick} style={{ left: pct(t) }}>
            {t}h
          </span>
        ))}
      </div>
    </div>
  );
}

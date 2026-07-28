import { useEffect, useState } from "react";

import type { RunOut } from "@/types/schedule";
import { cellPositionLabel } from "@/utils/plateWell";
import { computeTimeline, PPA_H, PREP_H, type StageTiming } from "@/utils/stageTimings";
import { classForUseIndex } from "@/utils/useIndexClass";

import styles from "./RunStageGantt.module.css";

const HOUR_MS = 3_600_000;
/** Candidate axis tick spacings (hours); the smallest that keeps the axis to ≤ MAX_TICKS labels
 *  wins — so a short run reads every 2 h and a long one every 6/12 h, never a wall of numbers. */
const TICK_STEPS_H = [2, 4, 6, 8, 12, 24];
const MAX_TICKS = 7;

/** "HH:MM" (UTC) for an epoch-ms instant - matches the app's UTC clock everywhere else. */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** The app's shared "live / now" glyph: a rotating 270° arc (matches InstrumentTrayMap's NOW
 *  pill), so a spinning icon means the same thing everywhere. CSS spins it; reduced-motion stops it. */
function LiveSpinner() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 1-7.5 4" />
    </svg>
  );
}

interface AxisTick {
  /** Hours from load - shares the bars' axis. */
  h: number;
  label: string;
}

/**
 * Clock-aligned ticks (…, 06:00, 12:00, 18:00, …) spanning the run, spaced so the axis stays
 * readable. Ticks land on round clock times (multiples of the step in UTC), not on load+N, so
 * the labels read cleanly and a 00:00 tick marks each day rollover.
 */
function buildAxisTicks(loadMs: number, spanH: number): AxisTick[] {
  const stepH = TICK_STEPS_H.find((s) => spanH / s <= MAX_TICKS) ?? 24;
  const stepMs = stepH * HOUR_MS;
  const endMs = loadMs + spanH * HOUR_MS;
  const ticks: AxisTick[] = [];
  // First clock-aligned instant at or after load, then step across the span.
  for (let ms = Math.ceil(loadMs / stepMs) * stepMs; ms <= endMs + 1000; ms += stepMs) {
    ticks.push({ h: (ms - loadMs) / HOUR_MS, label: hhmm(ms) });
  }
  return ticks;
}

function GanttRow({
  t,
  spanH,
  current,
  newGroup,
}: {
  t: StageTiming;
  spanH: number;
  current: boolean;
  /** First row of a new run in a multi-run gantt — gets a divider above it. */
  newGroup: boolean;
}) {
  const s = t.stage;
  // The physical cell's position label ("▣2"), same as the grid card's ticket stub.
  const cell = cellPositionLabel(s.tray_position, s.cell_home_well ?? s.well);
  const useClass = classForUseIndex(s.use_number);
  const pct = (h: number) => `${(h / spanH) * 100}%`;
  return (
    <div className={`${styles.row} ${current ? styles.current : ""} ${newGroup ? styles.groupStart : ""}`}>
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
        <div
          className={styles.ppa}
          style={{ left: pct(t.ppaStartH), width: pct(t.ppaEndH - t.ppaStartH) }}
          title={`PPA (post-primary analysis) ~${PPA_H} h · from ${hhmm(t.ppaStartMs)}`}
        />
      </div>
    </div>
  );
}

export interface RunStageGanttProps {
  /** One or more runs to lay out on a single shared timeline. Multiple runs (e.g. two runs
   * loaded on one instrument that overlap in time — up to 8 cells) share one axis and are
   * grouped by run, earliest first. */
  runs: RunOut[];
  /** The placement whose row is highlighted (the slot-detail popover's own slot); omit when
   * no single row is "current" (the instrument card shows every active run equally). */
  currentCellUseId?: number;
}

/**
 * A compact, estimated gantt of loaded wells across one or more runs: one row per well, each
 * showing three stages on a shared axis — a slate prep lead-in, the Use-coloured movie, then a
 * darker slate PPA / post-primary-analysis tail — over a clock-time axis. Multiple runs share
 * the axis and are separated by a divider so overlapping runs read clearly. When "now" falls
 * inside the span, a live green line (a spinning glyph on top) sweeps across all the bars to
 * show where sequencing is up to. Timings are the PacBio approximate-timing estimates (see
 * utils/stageTimings) - illustrative, not the instrument's exact schedule. Read-only; used in
 * the slot-detail popover (a single run) and on the Instruments cards (all active runs).
 */
export function RunStageGantt({ runs, currentCellUseId }: RunStageGanttProps) {
  const { loadMs, spanH, timings } = computeTimeline(runs);

  // Live "now" marker. A slow tick keeps the line's position current to the minute; the spinning
  // glyph (not this interval) is what signals "live". Hooks run unconditionally, so this sits
  // above the early return below.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (timings.length === 0 || spanH <= 0) return null;

  const pct = (h: number) => `${(h / spanH) * 100}%`;
  const ticks = buildAxisTicks(loadMs, spanH);
  const nowH = (nowMs - loadMs) / HOUR_MS;
  // Only show the live line while the run is actually in progress - not for a future (planned)
  // run, nor once it's fully past.
  const live = nowH >= 0 && nowH <= spanH;

  return (
    <div className={styles.wrap}>
      <div className={styles.caption}>
        <span className={styles.captionTitle}>Estimated stage times</span>
        <span className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swPrep}`} />
            prep
          </span>
          <span className={styles.legendItem} title="Movie colour matches the cell's use — magenta (1), blue (2), teal (3)">
            <span className={`${styles.swatch} ${styles.swMovie}`} />
            movie
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swPpa}`} />
            PPA
          </span>
        </span>
      </div>
      <div className={styles.rows}>
        {timings.map((t, i) => (
          <GanttRow
            key={t.stage.cell_use_id}
            t={t}
            spanH={spanH}
            current={t.stage.cell_use_id === currentCellUseId}
            newGroup={i > 0 && t.runId !== timings[i - 1].runId}
          />
        ))}
        {live && (
          <div className={styles.liveOverlay} aria-hidden>
            <div />
            <div className={styles.liveTrack}>
              <div className={styles.liveLine} style={{ left: pct(nowH) }} title={`Now · ${hhmm(nowMs)}`}>
                <span className={styles.liveGlyph}>
                  <LiveSpinner />
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className={styles.axis}>
        <div />
        <div className={styles.axisTrack}>
          {ticks.map((tk) => (
            <span key={tk.h} className={styles.tick} style={{ left: pct(tk.h) }}>
              {tk.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

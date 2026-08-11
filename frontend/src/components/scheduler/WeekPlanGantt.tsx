import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import type { RunOut } from "@/types/schedule";
import { shortWeekdayUTC } from "@/utils/calendarDates";
import { cellPositionLabel } from "@/utils/plateWell";
import { computeTimeline, PPA_H, PPA_SERVERS, PREP_H, type StageTiming } from "@/utils/stageTimings";
import { classForUseIndex } from "@/utils/useIndexClass";

import {
  buildWeekDayMarks,
  clipToWeek,
  computeLoadingWindowBands,
  computeNoisyBands,
  filterVisibleTimings,
} from "./weekPlanTiming";
import styles from "./WeekPlanGantt.module.css";

/** 0.01h in ms - the same "does this wait phase even exist" epsilon RunStageGantt uses,
 *  converted from hours to milliseconds since this component works in absolute time. */
const EPSILON_MS = 36_000;

/** "HH:MM" in the viewer's LOCAL timezone (the lab wall clock) for an epoch-ms instant.
 *  Deliberately a private copy of RunStageGantt's own `hhmm` (see that file) rather than a shared
 *  import - the two components must never be forced to change together just because they happen
 *  to format time the same way today. */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The app's shared "live / now" glyph (a rotating 270deg arc). Deliberately a private copy of
 *  RunStageGantt's own LiveSpinner, for the same reason as hhmm above. */
function LiveSpinner() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 1-7.5 4" />
    </svg>
  );
}

function WeekPlanGanttRow({
  t,
  weekStartMs,
  weekEndMs,
  newGroup,
}: {
  t: StageTiming;
  weekStartMs: number;
  weekEndMs: number;
  /** First row of a new run in this multi-run week - gets a divider above it. */
  newGroup: boolean;
}) {
  const s = t.stage;
  const cell = cellPositionLabel(s.tray_position, s.cell_home_well ?? s.well);
  const useClass = classForUseIndex(s.use_number);
  const clip = (startMs: number, endMs: number) => clipToWeek(startMs, endMs, weekStartMs, weekEndMs);

  const prepPending = t.prepStartMs - t.prepPendingStartMs > EPSILON_MS ? clip(t.prepPendingStartMs, t.prepStartMs) : null;
  const prep = clip(t.prepStartMs, t.movieStartMs);
  const movie = clip(t.movieStartMs, t.movieEndMs);
  const ppaWait = t.ppaStartMs - t.movieEndMs > EPSILON_MS ? clip(t.movieEndMs, t.ppaStartMs) : null;
  const ppa = clip(t.ppaStartMs, t.ppaEndMs);

  return (
    <div className={`${styles.row} ${newGroup ? styles.groupStart : ""}`}>
      <div className={styles.rowLabel} title={`Cell ${s.cell_ref} · Use ${s.use_number}`}>
        <span className={`${styles.stub} ${styles[useClass]}`}>{cell}</span>
        <span className={styles.sample}>{s.sample_external_id ?? "—"}</span>
      </div>
      <div className={styles.track}>
        {prepPending && (
          <div
            className={styles.prepPending}
            style={{ left: `${prepPending.leftPct}%`, width: `${prepPending.widthPct}%` }}
            title={`Loaded, waiting to break out — the instrument is busy (breaks out ${hhmm(t.prepStartMs)})`}
          />
        )}
        {prep && (
          <div
            className={styles.prep}
            style={{ left: `${prep.leftPct}%`, width: `${prep.widthPct}%` }}
            title={`Prep (breakout) ~${PREP_H} h · from ${hhmm(t.prepStartMs)}`}
          />
        )}
        {movie && (
          <div
            className={`${styles.movie} ${styles[useClass]}`}
            style={{ left: `${movie.leftPct}%`, width: `${movie.widthPct}%` }}
            title={`Movie ${hhmm(t.movieStartMs)}–${hhmm(t.movieEndMs)} · ${s.run_time_hours} h`}
          >
            <span className={styles.movieLabel}>{s.run_time_hours} h</span>
          </div>
        )}
        {ppaWait && (
          <div
            className={styles.ppaWait}
            style={{ left: `${ppaWait.leftPct}%`, width: `${ppaWait.widthPct}%` }}
            title={`Waiting for a PPA lane — only ${PPA_SERVERS} cells can be in PPA at once (PPA from ${hhmm(t.ppaStartMs)})`}
          />
        )}
        {ppa && (
          <div
            className={styles.ppa}
            style={{ left: `${ppa.leftPct}%`, width: `${ppa.widthPct}%` }}
            title={`PPA (post-primary analysis) ~${PPA_H} h · from ${hhmm(t.ppaStartMs)}`}
          />
        )}
      </div>
    </div>
  );
}

export interface WeekPlanGanttProps {
  /** Unfiltered fetch result (including the lookback window before weekStartMs) - fed to
   *  computeTimeline as-is so cross-run lane contention is computed correctly at the boundary. */
  runs: RunOut[];
  /** Monday 00:00 UTC of the visible week - the axis's fixed left edge. */
  weekStartMs: number;
  /** The following Monday 00:00 UTC - the axis's fixed right edge. */
  weekEndMs: number;
}

/**
 * A week-long, per-instrument gantt: the same prep/movie/PPA row language as RunStageGantt (the
 * Instruments card's compact "run in progress" chart), but on a FIXED calendar-week axis instead
 * of one auto-sized to a single run's span, with two whole-instrument summary strips above the
 * per-cell rows - "loading window" (when a fresh tray can't yet be loaded) and "noisy" (when PPA
 * is active) - so a lab user can read both at a glance instead of doing the maths themselves.
 * Read-only. A green "now" line behaves exactly as it does on the compact card; hovering/dragging
 * anywhere over the chart additionally sweeps a second, purple crosshair that reads out the exact
 * day/time under the cursor - the PacBio slide this was modelled on is hard to read exact times
 * off, so this view answers that interactively instead of adding more printed labels.
 */
export function WeekPlanGantt({ runs, weekStartMs, weekEndMs }: WeekPlanGanttProps) {
  const { timings: allTimings } = computeTimeline(runs);
  const timings = filterVisibleTimings(allTimings, weekStartMs, weekEndMs);
  const dayMarks = buildWeekDayMarks(weekStartMs);
  const loadingBands = computeLoadingWindowBands(timings);
  const noisyBands = computeNoisyBands(timings);
  const weekSpanMs = weekEndMs - weekStartMs;
  const pctOfWeek = (ms: number) => `${((ms - weekStartMs) / weekSpanMs) * 100}%`;

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const nowLive = nowMs >= weekStartMs && nowMs < weekEndMs;

  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const xPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverMs(weekStartMs + xPct * weekSpanMs);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.caption}>
        <span className={styles.captionTitle}>Week plan</span>
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
          <span className={styles.hint}>Hover the chart for the exact time</span>
        </span>
      </div>

      <div className={styles.dayHeader}>
        <div />
        <div className={styles.dayTrack}>
          {dayMarks.map((d) => (
            <span key={d.ms} className={styles.dayMark} style={{ left: pctOfWeek(d.ms) }}>
              {d.label}
            </span>
          ))}
          {hoverMs !== null && (
            <span className={styles.hoverPill} style={{ left: pctOfWeek(hoverMs) }}>
              {`${shortWeekdayUTC(new Date(hoverMs))} ${hhmm(hoverMs)}`}
            </span>
          )}
        </div>
      </div>

      <div className={styles.rows} onPointerMove={handlePointerMove} onPointerLeave={() => setHoverMs(null)}>
        <div className={styles.stripRow}>
          <div className={styles.stripLabel} title="When this instrument can't yet accept a fresh tray">
            Loading window
          </div>
          <div className={styles.track}>
            {loadingBands.map((b) => {
              const c = clipToWeek(b.startMs, b.endMs, weekStartMs, weekEndMs);
              return (
                c && (
                  <div
                    key={b.startMs}
                    className={styles.loadingBand}
                    style={{ left: `${c.leftPct}%`, width: `${c.widthPct}%` }}
                    title={`Locked — can't load a fresh tray ${hhmm(b.startMs)}–${hhmm(b.endMs)}`}
                  />
                )
              );
            })}
          </div>
        </div>
        <div className={styles.stripRow}>
          <div className={styles.stripLabel} title="When post-primary analysis (PPA) is active on this instrument">
            Noisy (PPA)
          </div>
          <div className={styles.track}>
            {noisyBands.map((b) => {
              const c = clipToWeek(b.startMs, b.endMs, weekStartMs, weekEndMs);
              return (
                c && (
                  <div
                    key={b.startMs}
                    className={styles.noisyBand}
                    style={{ left: `${c.leftPct}%`, width: `${c.widthPct}%` }}
                    title={`PPA active ${hhmm(b.startMs)}–${hhmm(b.endMs)}`}
                  />
                )
              );
            })}
          </div>
        </div>

        {timings.map((t, i) => (
          <WeekPlanGanttRow
            key={t.stage.cell_use_id}
            t={t}
            weekStartMs={weekStartMs}
            weekEndMs={weekEndMs}
            newGroup={i > 0 && t.runId !== timings[i - 1].runId}
          />
        ))}

        <div className={styles.overlay} aria-hidden>
          <div />
          <div className={styles.overlayTrack} ref={trackRef}>
            {nowLive && (
              <div className={styles.liveLine} style={{ left: pctOfWeek(nowMs) }} title={`Now · ${hhmm(nowMs)}`}>
                <span className={styles.liveGlyph}>
                  <LiveSpinner />
                </span>
              </div>
            )}
            {hoverMs !== null && <div className={styles.hoverLine} style={{ left: pctOfWeek(hoverMs) }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

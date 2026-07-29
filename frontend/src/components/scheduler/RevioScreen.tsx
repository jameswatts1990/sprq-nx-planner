import { useEffect, useMemo, useState } from "react";

import type { RunOut } from "@/types/schedule";
import type { InstrumentStatus } from "@/utils/instrumentStatus";
import { computeTimeline, type StageTiming } from "@/utils/stageTimings";
import { classForUseIndex } from "@/utils/useIndexClass";
import { CELL_LIFETIME_H } from "@/utils/windowFade";

import styles from "./RevioScreen.module.css";

const HOUR_MS = 3_600_000;

/** The idle-screen note per status: an online-but-empty machine reads "idle", while down /
 * retired ones say so, since the card header (which used to carry a status badge) is gone. */
const IDLE_LABEL: Record<InstrumentStatus, string> = {
  ready: "Idle · no cells loaded",
  running: "Idle · no cells loaded", // unreachable (a running machine renders its rows), a safe fallback
  down: "Down for maintenance",
  inactive: "Retired",
};

/** The four columns the physical Revio touchscreen groups a run's cells into, in order. Mapped
 * from the app's per-cell timing model (utils/stageTimings): a cell is Pending until it breaks
 * out, Loading while it preps (breakout), Sequencing during its movie, and Complete once the
 * movie ends (PPA and after). */
const PHASES = ["pending", "loading", "sequencing", "complete"] as const;
type RevioPhase = (typeof PHASES)[number];
const PHASE_LABEL: Record<RevioPhase, string> = {
  pending: "Pending",
  loading: "Loading",
  sequencing: "Sequencing",
  complete: "Complete",
};

function phaseAt(t: StageTiming, nowH: number): RevioPhase {
  if (nowH < t.prepStartH) return "pending";
  if (nowH < t.movieStartH) return "loading";
  if (nowH < t.movieEndH) return "sequencing";
  return "complete";
}

/** "2d 01h" / "01h 15m" / "12m" — matches the Revio screen's own countdown format (zero-padded
 * hours), stepping the unit down as the remaining time shrinks. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${pad(h)}h ${pad(m)}m`;
  return `${m}m`;
}

/** "36h 22m" — total hours (not rolled into days), the format the machine's lock badge uses. */
function formatLockTime(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** The Revio's own padlock glyph for the lock-timer badge — a stroke icon so it inherits the
 * screen's light text colour (an emoji lock would read as a coloured sticker on the black panel). */
function LockIcon() {
  return (
    <svg width="0.9em" height="0.9em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

interface ResidentCell {
  cellId: number;
  cellRef: string;
  useNumber: number;
  usesLeft: number;
  sample: string | null;
}

interface RunSummary {
  runId: number;
  name: string;
  /** Cells bucketed into the four Revio stage columns. */
  byPhase: Record<RevioPhase, StageTiming[]>;
  /** Absolute epoch-ms this run's last cell finishes (movie + PPA); null if nothing timed. */
  endMs: number | null;
}

export interface RevioScreenProps {
  /** The instrument's serial (shown large, like the physical machine's own screen). */
  serial: string;
  /** Optional friendly label (e.g. "Revio A") — shown small under the serial, since this panel
   * now stands in for the card header that used to carry it. */
  name?: string | null;
  /** The instrument's at-a-glance status — drives the idle-screen note (down / retired / idle). */
  status: InstrumentStatus;
  /** True when no run is in progress: the passed `runs` are then the *most recent* (finished)
   * run(s), retained on screen like the physical machine, rather than live ones. */
  idle: boolean;
  /** Runs to show — the runs in progress right now, or (when `idle`) the most recent finished
   * run(s) retained on screen. One row each. */
  runs: RunOut[];
  /** When the runs were last fetched (React Query dataUpdatedAt): the baseline the live 108h
   * "Use within" countdown ticks down from, since window_hours_elapsed is a snapshot. */
  dataUpdatedAt: number;
}

/**
 * A compact replica of the PacBio Revio/SPRQ-Nx instrument touchscreen for one instrument: the
 * serial in large type, a "Remaining SMRT Cell uses" box with a live "Use within" 108h countdown,
 * and one row per run in progress showing its cells spread across the machine's four stage columns
 * (Pending → Loading → Sequencing → Complete) with a per-run time-remaining. Built entirely from
 * the same per-cell timing model as the stage-times gantt (utils/stageTimings), so the two agree.
 * Always dark (it mimics the physical black screen) regardless of the app theme. Renders nothing
 * when no run is in progress — an idle machine shows no screen, same as the real instrument.
 */
export function RevioScreen({ serial, name, status, idle, runs, dataUpdatedAt }: RevioScreenProps) {
  // The machine leads with its friendly name (e.g. "Yoda") when it has one, else the serial;
  // the serial then reads as a small subtitle so it's never lost (the card header that used to
  // carry both is gone).
  const bigLabel = name || serial;
  const serialSub = name && name !== serial ? serial : null;
  // Live "now": a slow tick keeps the countdowns and stage buckets current without a refetch.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { loadMs, timings } = useMemo(() => computeTimeline(runs), [runs]);
  const nameByRun = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of runs) m.set(r.run_id, r.run_name || `#${r.run_id}`);
    return m;
  }, [runs]);

  const nowH = (nowMs - loadMs) / HOUR_MS;

  // Group timings into runs (they arrive already ordered by run then slot), bucketing each run's
  // cells into the four stage columns by their phase at "now".
  const runSummaries = useMemo<RunSummary[]>(() => {
    const order: number[] = [];
    const byRun = new Map<number, RunSummary>();
    for (const t of timings) {
      let s = byRun.get(t.runId);
      if (!s) {
        s = {
          runId: t.runId,
          name: nameByRun.get(t.runId) ?? `#${t.runId}`,
          byPhase: { pending: [], loading: [], sequencing: [], complete: [] },
          endMs: null,
        };
        byRun.set(t.runId, s);
        order.push(t.runId);
      }
      s.byPhase[phaseAt(t, nowH)].push(t);
      s.endMs = s.endMs === null ? t.ppaEndMs : Math.max(s.endMs, t.ppaEndMs);
    }
    return order.map((id) => byRun.get(id)!);
  }, [timings, nameByRun, nowH]);

  // "Remaining SMRT Cell uses": the physical cells on stages right now (not yet Complete), one box
  // each, deduped by physical cell (a reused cell shows once, on its active use).
  const resident = useMemo<ResidentCell[]>(() => {
    const seen = new Set<number>();
    const out: ResidentCell[] = [];
    for (const t of timings) {
      if (phaseAt(t, nowH) === "complete") continue;
      if (seen.has(t.stage.cell_id)) continue;
      seen.add(t.stage.cell_id);
      out.push({
        cellId: t.stage.cell_id,
        cellRef: t.stage.cell_ref,
        useNumber: t.stage.use_number,
        usesLeft: Math.max(0, t.stage.cell_max_uses - t.stage.use_number),
        sample: t.stage.sample_external_id,
      });
    }
    return out;
  }, [timings, nowH]);

  // "Use within": the soonest 108h deadline among the cells on stages — the next cell to expire.
  // A started cell's deadline is anchored on its recorded elapsed (relative to when the data was
  // fetched); a not-yet-broken-out cell's on its projected breakout, so the number is always real.
  const nextDeadlineMs = useMemo<number | null>(() => {
    let soonest: number | null = null;
    for (const t of timings) {
      if (phaseAt(t, nowH) === "complete") continue;
      const elapsed = t.stage.window_hours_elapsed;
      const deadline =
        elapsed != null
          ? dataUpdatedAt + (CELL_LIFETIME_H - elapsed) * HOUR_MS
          : t.prepStartMs + CELL_LIFETIME_H * HOUR_MS;
      soonest = soonest === null ? deadline : Math.min(soonest, deadline);
    }
    return soonest;
  }, [timings, nowH, dataUpdatedAt]);

  // Nothing loaded → the machine's screen sits idle (still shown, same size, like the always-on
  // physical display), just the serial and a quiet status note — no uses box or stage rows.
  if (timings.length === 0) {
    return (
      <div className={`${styles.screen} ${styles.screenIdle}`}>
        <div className={styles.serialWrap}>
          <span className={styles.serial}>{bigLabel}</span>
          {serialSub && <span className={styles.name}>{serialSub}</span>}
        </div>
        <div className={styles.idleFill}>
          <span className={`${styles.idleTag} ${status === "down" ? styles.idleWarn : ""}`}>{IDLE_LABEL[status]}</span>
        </div>
      </div>
    );
  }

  // Instrument load-lock: free to START a new run once the LAST cell finishes prep — the end of
  // the purple "Prep" bars in the PacBio adaptive-loading slide, and the "awaiting-prep ⇒ locked"
  // rule in docs/pacbio-sprq-nx-scheduling-reference.md. Fully dynamic in the run's cell count via
  // the shared timing model — each cell's movieStartMs IS its prep-done instant — so the lock is
  // just the latest of those: 1 cell ~4h, a full tray of 4 ~10h (4h prep, 2h-staggered), up to
  // ~38h for 8 (the 2nd tray can't prep until the 1st frees the 4 sequencing lanes ~28h in). NOT
  // a flat buffer, and NOT the acquisition/PPA end. ≤ 0 (all prep done / idle) hides the badge.
  const prepDoneMs = timings.reduce((m, t) => Math.max(m, t.movieStartMs), 0);
  const lockRemaining = prepDoneMs - nowMs;

  return (
    <div className={styles.screen}>
      <div className={styles.top}>
        <div className={styles.serialWrap}>
          <span className={styles.serial}>{bigLabel}</span>
          {serialSub && <span className={styles.name}>{serialSub}</span>}
        </div>
        {idle ? (
          // Idle but retaining its last run(s): a quiet "Idle" chip where the live uses box sits.
          <span className={`${styles.idleTag} ${status === "down" ? styles.idleWarn : ""}`}>{IDLE_LABEL[status]}</span>
        ) : (
          <div className={styles.topRight}>
            {lockRemaining > 0 && (
              <span className={styles.lockBadge} title={`Instrument busy — frees in ${formatLockTime(lockRemaining)}`}>
                <LockIcon /> {formatLockTime(lockRemaining)}
              </span>
            )}
            {resident.length > 0 && (
              <div className={styles.uses}>
                <span className={styles.usesTitle}>Remaining SMRT Cell uses</span>
                <div className={styles.useBoxes}>
                  {resident.map((c) => (
                    <span
                      key={c.cellId}
                      className={`${styles.useBox} ${styles[classForUseIndex(c.useNumber)]}`}
                      title={`Cell ${c.cellRef} · use ${c.useNumber} · ${c.usesLeft} use${c.usesLeft === 1 ? "" : "s"} left${c.sample ? ` · ${c.sample}` : ""}`}
                    >
                      {c.usesLeft}
                    </span>
                  ))}
                </div>
                {nextDeadlineMs != null && (
                  <span className={styles.useWithin}>
                    Use within: <b>{formatCountdown(nextDeadlineMs - nowMs)}</b>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.runs}>
        {runSummaries.map((run) => {
          const remaining = run.endMs != null ? run.endMs - nowMs : 0;
          const running = remaining > 0;
          return (
            <div key={run.runId} className={styles.run}>
              <div className={styles.runHead}>
                <span className={styles.runName} title={run.name}>
                  {run.name}
                </span>
                {running ? (
                  <span className={styles.runTime}>{formatCountdown(remaining)}</span>
                ) : (
                  <span className={styles.runDone}>done</span>
                )}
              </div>
              <div className={styles.stages}>
                {PHASES.map((phase) => {
                  const cells = run.byPhase[phase];
                  return (
                    <div key={phase} className={styles.stage}>
                      <span className={styles.stageLabel}>{PHASE_LABEL[phase]}</span>
                      <div className={styles.pips}>
                        {cells.map((t) => (
                          <span
                            key={t.stage.cell_use_id}
                            className={`${styles.pip} ${styles[classForUseIndex(t.stage.use_number)]} ${styles[`p_${phase}`]}`}
                            title={`${t.stage.sample_external_id ?? t.stage.cell_ref} · use ${t.stage.use_number} · ${PHASE_LABEL[phase]}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

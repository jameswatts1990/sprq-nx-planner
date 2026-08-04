import { useState } from "react";
import type { ReactNode } from "react";

import { LoadTimePicker } from "@/components/scheduler/LoadTimePicker";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { NoteTone } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { CellsPerDay, MaxUses, Objective, RunTimeHours } from "@/types/schedule";
import type { RunDesignState } from "@/types/schedulerGrid";

import styles from "./RunDesignFields.module.css";

function fmtLoadHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** The three per-sample movie lengths, offered as include/exclude tickboxes. */
const MOVIE_TIME_OPTIONS: RunTimeHours[] = [12, 24, 30];

/** Add or remove a movie time from the include set, kept ascending for a stable summary. */
function toggleMovieTime(current: RunTimeHours[], h: RunTimeHours): RunTimeHours[] {
  return current.includes(h) ? current.filter((m) => m !== h) : [...current, h].sort((a, b) => a - b);
}

export interface RunDesignFieldsProps {
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
  /** Optional "trays autoschedule will reuse" list (AutoscheduleReuseTrays), rendered just
   * above the Auto schedule button. Omitted on the Help tab's static preview of these dials. */
  reuseTraysSlot?: ReactNode;
}

const MAX_USES_OPTIONS = [
  { value: 1 as MaxUses, label: "1×" },
  { value: 2 as MaxUses, label: "2×" },
  { value: 3 as MaxUses, label: "3×" },
];
/** Three strategies. The stored `value` is the engine mode name (see Objective in
 * types/schedule.ts); the `label` is what the lab user reads. "Fastest" fills a whole
 * tray so every sample starts sooner (each cell then has a running expiry timer);
 * "Efficient" reuses a cell to depth before opening the next, so fewer cells expire;
 * "By order" fills the grid strictly in upload/CSV sequence (ignoring priority), using
 * the same fill-a-tray cell choice as "Fastest". */
const OBJECTIVE_OPTIONS = [
  { value: "utilisation" as Objective, label: "Fastest", hint: "fill trays, start sooner" },
  { value: "fewest" as Objective, label: "Efficient", hint: "reuse cells, limit expiry" },
  { value: "order" as Objective, label: "By order", hint: "upload / CSV sequence" },
];
const PLATES_PER_RUN_OPTIONS = [
  { value: 4 as CellsPerDay, label: "1 plate", hint: "up to 4 samples/day" },
  { value: 8 as CellsPerDay, label: "2 plates", hint: "up to 8 samples/day" },
];

/** Human label for a stored objective value - shared so summaries elsewhere never print
 * the raw engine mode name. */
export function objectiveLabel(objective: Objective): string {
  return OBJECTIVE_OPTIONS.find((o) => o.value === objective)?.label ?? objective;
}

/** Short one-line summary of the current dials, e.g. for the Autoschedule drawer subtitle. */
export function runDesignSummary(runDesign: RunDesignState): string {
  const movies = runDesign.movie_times.length ? `${runDesign.movie_times.join("/")} h` : "no movie times";
  return `${runDesign.max_uses}× · ${movies} · loads ${fmtLoadHour(runDesign.load_hour)} · ${objectiveLabel(
    runDesign.objective,
  )} · ${runDesign.cells_per_day === 8 ? "2 plates" : "1 plate"}`;
}

/** The Autoschedule dials that feed both single placements (place mutation) and batch
 * auto-fill. Instrument + start-date selection happens spatially in the grid, so auto-fill
 * acts on the current grid range-selection. Rendered inside the Schedule page's
 * Autoschedule drawer (AutoscheduleDrawer) and, statically, on the Help tab. */
export function RunDesignFields({
  runDesign,
  onChange,
  selectedCount,
  onAutoSchedule,
  autoFilling,
  weekPlannedCount,
  onRequestClearSchedule,
  note,
  reuseTraysSlot,
}: RunDesignFieldsProps) {
  const [pickingLoadTime, setPickingLoadTime] = useState(false);
  return (
    <>
      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          Max uses per cell <span className={styles.hint}>auto-fill target depth</span>
        </div>
        <SegmentedControl
          ariaLabel="Max uses per cell"
          options={MAX_USES_OPTIONS}
          value={runDesign.max_uses}
          onChange={(v) => onChange({ ...runDesign, max_uses: v })}
          fullWidth
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          Movie times <span className={styles.hint}>which sample movie lengths to include</span>
        </div>
        <div className={styles.movieRow} role="group" aria-label="Movie times to include">
          {MOVIE_TIME_OPTIONS.map((h) => {
            const checked = runDesign.movie_times.includes(h);
            return (
              <label key={h} className={`${styles.movieOption} ${checked ? styles.movieOptionChecked : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange({ ...runDesign, movie_times: toggleMovieTime(runDesign.movie_times, h) })}
                />
                {h} h
              </label>
            );
          })}
        </div>
        <p className={styles.movieNote}>
          Auto Schedule only pulls backlog samples whose movie time is ticked, and runs each cell for its own length.{" "}
          <b>12 h</b> samples load only on <b>cell 1</b> and <b>30 h</b> only on <b>cell 4</b>; <b>24 h</b> can use any
          cell.
        </p>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          Load time <span className={styles.hint}>when a new run loads &amp; starts sequencing</span>
        </div>
        <Button
          className={styles.loadBtn}
          onClick={() => setPickingLoadTime(true)}
          aria-label={`Load time: ${fmtLoadHour(runDesign.load_hour)} — change`}
        >
          Loads {fmtLoadHour(runDesign.load_hour)}
        </Button>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>Optimise for</div>
        <SegmentedControl
          ariaLabel="Optimisation objective"
          options={OBJECTIVE_OPTIONS}
          value={runDesign.objective}
          onChange={(v) => onChange({ ...runDesign, objective: v })}
          fullWidth
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldLabel}>
          Plates per run <span className={styles.hint}>cap on samples scheduled per day (4 or 8)</span>
        </div>
        <SegmentedControl
          ariaLabel="Plates per run"
          options={PLATES_PER_RUN_OPTIONS}
          value={runDesign.cells_per_day}
          onChange={(v) => onChange({ ...runDesign, cells_per_day: v })}
          fullWidth
        />
      </div>

      {reuseTraysSlot}

      <div className={styles.autoBar}>
        <Button
          variant="primary"
          onClick={onAutoSchedule}
          disabled={selectedCount === 0 || autoFilling || runDesign.movie_times.length === 0}
        >
          {autoFilling ? "Auto scheduling…" : `Auto schedule (${selectedCount} selected)`}
        </Button>
        <Button onClick={onRequestClearSchedule} disabled={weekPlannedCount === 0}>
          {`Clear schedule (${weekPlannedCount} planned)`}
        </Button>
        <span className={styles.autoHint}>
          Select empty cells in the grid, then auto-fill from the backlog. Clear schedule wipes this week&apos;s planned
          runs.
          {runDesign.movie_times.length === 0 && " Tick at least one movie time to enable Auto schedule."}
        </span>
      </div>

      {note && (
        <div className={styles.note}>
          <Note tone={note.tone} icon={note.icon}>
            {note.text}
          </Note>
        </div>
      )}

      {pickingLoadTime && (
        <LoadTimePicker
          value={runDesign.load_hour}
          subtitle="The load time Auto Schedule uses, and the default for a manual drop."
          onCancel={() => setPickingLoadTime(false)}
          onPick={(hour) => {
            onChange({ ...runDesign, load_hour: hour });
            setPickingLoadTime(false);
          }}
        />
      )}
    </>
  );
}

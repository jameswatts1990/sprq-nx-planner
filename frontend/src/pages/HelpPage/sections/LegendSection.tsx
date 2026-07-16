import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import type { CellGhost } from "@/components/scheduler/waitingCells";
import { UseLegend } from "@/components/shared/SectionHeading";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Note, type NoteTone } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import { CELL_STATUSES, CELL_USE_STATUSES, CYCLE_STATUSES } from "@/types/common";
import type { CellStatus, CellUseStatus, CycleStatus } from "@/types/common";
import type { StageOut } from "@/types/schedule";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import type { CellQcFlag } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { priorityTone } from "@/utils/priority";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "../HelpPage.module.css";

// Fabricated example cell/ghost, purely so the two waiting-cell ghost styles below render
// from the real SchedulerSlotView component (see CLAUDE.md's Help Tab Maintenance rule) -
// never hand-describe this colour scheme in prose.
const GHOST_EXAMPLE_CELL: CellOut = {
  id: 0,
  code: "CELL-000042",
  max_uses: 3,
  status: "open",
  uses_consumed: 1,
  uses_remaining: 2,
  burned_barcodes: [],
  window_hours_elapsed: 60,
  window_breached: false,
  current_instrument_serial: "84047",
  current_well: "A01",
  last_use_run_date: "2026-07-13",
  first_use_started_at: "2026-07-13T12:00:00Z",
  first_use_planned_start_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T12:00:00Z",
  stopped_reason: null,
  stopped_at: null,
  has_failed_use: false,
  needs_qc_report: false,
  awaiting_credit: false,
  pacbio_case_number: null,
  pacbio_reported_at: null,
  pacbio_credit_confirmed_at: null,
  credit_received_at: null,
};
const GHOST_EXAMPLE_FADING: CellGhost = {
  cell: GHOST_EXAMPLE_CELL,
  useNumber: 2,
  isHardCutoff: false,
  fadeOpacity: 0.65,
  cutoffDate: "2026-07-17",
  deadlineAt: "2026-07-18T00:00:00Z",
  deadlineIsEstimated: false,
};
const GHOST_EXAMPLE_CUTOFF: CellGhost = { ...GHOST_EXAMPLE_FADING, isHardCutoff: true };

// Fabricated stages sharing one cell_id, purely so the cell-link highlight swatches below
// render from the real SchedulerSlotView component (see CLAUDE.md's Help Tab Maintenance
// rule) - never hand-describe this colour/border scheme in prose.
const LINK_EXAMPLE_SOURCE: StageOut = {
  slot_index: 0,
  well: "A01",
  cell_use_id: 1,
  cell_id: 42,
  cell_ref: "CELL-000042",
  use_number: 1,
  sample_id: 1,
  sample_external_id: "SAMPLE-101",
  barcodes: ["bc1001"],
  cell_use_status: "completed",
  cell_status: "open",
};
const LINK_EXAMPLE_PEER: StageOut = {
  ...LINK_EXAMPLE_SOURCE,
  slot_index: 4,
  well: "A02",
  cell_use_id: 2,
  use_number: 2,
  sample_id: 2,
  sample_external_id: "SAMPLE-205",
  barcodes: ["bc2005"],
};
const LINK_EXAMPLE_UNRELATED: StageOut = {
  ...LINK_EXAMPLE_SOURCE,
  slot_index: 1,
  well: "B01",
  cell_use_id: 3,
  cell_id: 99,
  cell_ref: "CELL-000099",
  sample_id: 3,
  sample_external_id: "SAMPLE-310",
  barcodes: ["bc3010"],
};

// Fabricated stages purely so the QC alert swatches below render from the real
// SchedulerSlotView component (see CLAUDE.md's Help Tab Maintenance rule).
const QC_EXAMPLE_FAILED: StageOut = {
  ...LINK_EXAMPLE_SOURCE,
  cell_use_id: 4,
  cell_id: 7,
  cell_ref: "CELL-000007",
  sample_id: 4,
  sample_external_id: "SAMPLE-410",
  barcodes: ["bc4010"],
  cell_use_status: "failed",
  cell_status: "open",
};
const QC_EXAMPLE_STOPPED: StageOut = {
  ...QC_EXAMPLE_FAILED,
  cell_use_id: 5,
  cell_id: 8,
  cell_ref: "CELL-000008",
  sample_id: 5,
  sample_external_id: "SAMPLE-512",
  barcodes: ["bc5012"],
  cell_use_status: "completed",
  cell_status: "stopped",
};
const QC_EXAMPLE_ABORTED: StageOut = {
  ...QC_EXAMPLE_FAILED,
  cell_use_id: 6,
  cell_id: 9,
  cell_ref: "CELL-000009",
  sample_id: 6,
  sample_external_id: "SAMPLE-618",
  barcodes: ["bc6018"],
  cell_use_status: "aborted",
  cell_status: "open",
};

const CELL_STATUS_MEANING: Record<CellStatus, string> = {
  open: "Has uses remaining and its window is still valid; available to schedule.",
  exhausted: "All of the cell's uses are spent.",
  window_expired: "The cell passed its 108-hour lifetime window and can no longer be used.",
  retired: "The cell was manually taken out of service.",
  stopped: "QC failed the cell - all of its not-yet-run uses were cancelled and it will never be reused.",
};

const CYCLE_STATUS_MEANING: Record<CycleStatus, string> = {
  planned: "Scheduled but not yet loaded; still editable.",
  running: "Confirmed loaded / currently sequencing.",
  completed: "The run has finished.",
  aborted: "The run was stopped or cancelled.",
};

const USE_STATUS_MEANING: Record<CellUseStatus, string> = {
  planned: "Scheduled onto a cell but the run hasn't started.",
  started: "The run is under way.",
  completed: "The use finished successfully.",
  failed: "The use did not complete successfully - the cell may be at fault; the sample is marked Failed.",
  aborted: "The run/instrument was the problem, not the cell or sample - the sample returns straight to the backlog.",
  cancelled: "The use was cancelled before or during the run.",
};

const SAMPLE_STATUS_TONE: Record<"completed" | "failed", BadgeTone> = {
  completed: "success",
  failed: "danger",
};

const SAMPLE_STATUS_MEANING: Record<"completed" | "failed", string> = {
  completed: "The sample finished sequencing successfully.",
  failed: "The sample did not complete successfully.",
};

const CELL_QC_FLAG_MEANING: Record<CellQcFlag, string> = {
  unreported: "The cell has a Failed use or is Stopped, and no PacBio case has been raised for it yet.",
  awaiting_credit: "The cell has been reported to PacBio, but the credit hasn't physically arrived in the lab yet.",
};
const CELL_QC_FLAGS: CellQcFlag[] = ["unreported", "awaiting_credit"];

// Priority is free text imported from the sample sheet (no fixed set of values), so
// these are illustrative examples - the colouring itself comes from the real
// priorityTone() function, keyed off the same "(N)" rank convention as the backend.
const PRIORITY_EXAMPLES: { label: string; meaning: string }[] = [
  { label: "High (1)", meaning: "Rank 1 - the most urgent priority." },
  { label: "Medium (2)", meaning: "Rank 2 - elevated priority." },
  { label: "Standard (3)", meaning: "Rank 3 or lower, or unlabelled - the default priority." },
];

const NOTE_EXAMPLES: { tone: NoteTone; icon: string; label: string; text: string }[] = [
  { tone: "info", icon: "i", label: "Info (blue)", text: "Neutral status, e.g. “No active instruments configured.”" },
  { tone: "good", icon: "✓", label: "Success (green)", text: "An action worked, e.g. “12 sample(s) cleared from the schedule.”" },
  { tone: "warn", icon: "!", label: "Warning (amber)", text: "Succeeded with caveats, e.g. import warnings or window flags." },
  { tone: "bad", icon: "!", label: "Error (red)", text: "An action failed and needs attention." },
];

/** Renders the *real* Badge/Note/UseLegend components sourced from the same shared
 * tone maps every other page uses (utils/cellStatus.ts, utils/cycleStatus.ts,
 * utils/useStatusTone.ts) - never hardcode or re-describe a colour in prose here, so
 * this legend can't visually drift from the live app as those maps or tokens.css
 * evolve. See CLAUDE.md's "Help Tab Maintenance" section. */
export function LegendSection() {
  return (
    <div className={styles.copy}>
      <p>
        These are the actual colours and labels used across the app. They update automatically if the app&apos;s
        styling changes, so what you see here always matches the real screens.
      </p>

      <p className={styles.subheading}>Cell status (Cells &amp; Instruments, Cell detail)</p>
      <div className={styles.legendGrid}>
        {CELL_STATUSES.map((s) => (
          <div className={styles.legendRow} key={s}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={CELL_STATUS_TONE[s]}>{CELL_STATUS_LABEL[s]}</Badge>
            </span>
            <span>{CELL_STATUS_MEANING[s]}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>QC / credit flags (Cells &amp; Instruments, Cell detail)</p>
      <div className={styles.legendGrid}>
        {CELL_QC_FLAGS.map((f) => (
          <div className={styles.legendRow} key={f}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={CELL_QC_FLAG_TONE[f]}>{CELL_QC_FLAG_LABEL[f]}</Badge>
            </span>
            <span>{CELL_QC_FLAG_MEANING[f]}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Run status (History, Schedule)</p>
      <div className={styles.legendGrid}>
        {CYCLE_STATUSES.map((s) => (
          <div className={styles.legendRow} key={s}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={CYCLE_STATUS_TONE[s]}>{s}</Badge>
            </span>
            <span>{CYCLE_STATUS_MEANING[s]}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Use status (Cell detail, run slots)</p>
      <div className={styles.legendGrid}>
        {CELL_USE_STATUSES.map((s) => (
          <div className={styles.legendRow} key={s}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={USE_STATUS_TONE[s]}>{s}</Badge>
            </span>
            <span>{USE_STATUS_MEANING[s]}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Sample status (History → Samples)</p>
      <div className={styles.legendGrid}>
        {(["completed", "failed"] as const).map((s) => (
          <div className={styles.legendRow} key={s}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={SAMPLE_STATUS_TONE[s]}>{s}</Badge>
            </span>
            <span>{SAMPLE_STATUS_MEANING[s]}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Priority (Backlog)</p>
      <div className={styles.legendGrid}>
        {PRIORITY_EXAMPLES.map((p) => (
          <div className={styles.legendRow} key={p.label}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={priorityTone(p.label)}>{p.label}</Badge>
            </span>
            <span>{p.meaning}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Use colours (schedule barcode chips)</p>
      <div className={styles.legendRow}>
        <UseLegend />
        <span>Which acquisition of a cell a barcode belongs to.</span>
      </div>

      <p className={styles.subheading}>Waiting-cell ghosts (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_FADING} />
          </div>
          <span>
            A cell with unused capacity could be loaded here today - tinted like the use it&apos;s waiting to
            become and labelled with the exact day its window closes, fading from full colour toward a paler tint
            as that date nears.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_CUTOFF} />
          </div>
          <span>
            Last day this cell can still start its next use - a fixed amber &quot;expires today&quot; look instead
            of continuing to fade.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Cell-link highlight (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={LINK_EXAMPLE_SOURCE} slotIndex={0} linkSource />
          </div>
          <span>The exact slot you&apos;re hovering or have pinned - a solid ring with a filled dot.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={LINK_EXAMPLE_PEER} slotIndex={4} linked />
          </div>
          <span>Another use of that same physical cell, wherever it lands on the calendar - a dashed ring with a hollow dot.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={LINK_EXAMPLE_UNRELATED} slotIndex={1} dimmed />
          </div>
          <span>An unrelated cell, softened so the linked slots stand out.</span>
        </div>
      </div>

      <p className={styles.subheading}>QC alert (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={QC_EXAMPLE_FAILED} slotIndex={0} />
          </div>
          <span>This use was marked Failed - a red ring and label, right on the grid.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={QC_EXAMPLE_STOPPED} slotIndex={0} />
          </div>
          <span>
            This slot&apos;s physical cell has been Stopped - shown the same way, even on a use that itself
            completed normally, since the cell is now out of service for good.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={QC_EXAMPLE_ABORTED} slotIndex={0} />
          </div>
          <span>
            This use was marked Aborted - a milder amber ring, since the run/instrument was the problem rather than
            the cell itself; the sample has already gone back to the backlog.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Alert notes you&apos;ll see throughout</p>
      <div className={styles.noteExamples}>
        {NOTE_EXAMPLES.map((n) => (
          <Note tone={n.tone} icon={n.icon} key={n.label}>
            <b>{n.label}</b> — {n.text}
          </Note>
        ))}
      </div>
    </div>
  );
}

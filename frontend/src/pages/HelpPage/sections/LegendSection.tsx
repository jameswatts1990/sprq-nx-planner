import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { CellStatusCard } from "@/components/cells/CellStatusCard";
import { TraySiblingList } from "@/components/cells/TraySiblingList";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { UseLegend } from "@/components/shared/SectionHeading";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Note, type NoteTone } from "@/components/ui/Note";
import { CELL_STATUSES, CELL_USE_STATUSES, CYCLE_STATUSES } from "@/types/common";
import type { CellStatus, CellUseStatus, CycleStatus } from "@/types/common";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import type { CellQcFlag } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { priorityTone } from "@/utils/priority";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "../HelpPage.module.css";
import {
  EXAMPLE_CELL_UNREPORTED,
  EXAMPLE_TRAY_SIBLINGS,
  GHOST_EXAMPLE_CUTOFF,
  GHOST_EXAMPLE_FADING,
  GHOST_EXAMPLE_UNUSED,
  STAGE_EXAMPLE_ABORTED,
  STAGE_EXAMPLE_CANCELLED,
  STAGE_EXAMPLE_FAILED,
  STAGE_EXAMPLE_PEER,
  STAGE_EXAMPLE_SOURCE,
  STAGE_EXAMPLE_STOPPED,
  STAGE_EXAMPLE_UNRELATED,
  STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE,
} from "./helpFixtures";

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

/** Renders the *real* Badge/Note/UseLegend/CellStatusCard/WindowMeter/TraySiblingList
 * components sourced from the same shared tone maps every other page uses
 * (utils/cellStatus.ts, utils/cycleStatus.ts, utils/useStatusTone.ts) - never hardcode or
 * re-describe a colour in prose here, so this legend can't visually drift from the live
 * app as those maps or tokens.css evolve. See CLAUDE.md's "Help Tab Maintenance" section. */
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
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_UNUSED} />
          </div>
          <span>
            A physical tray&apos;s cell that has never been used at all - a muted grey, static dotted look with no
            countdown (deliberately not tinted by use number, so it never reads as an already-loaded Use 1), since
            its 108-hour clock hasn&apos;t started yet. Shows up the moment its tray opens and stays until it&apos;s
            loaded or discarded.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Slot shading (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE} slotIndex={0} />
          </div>
          <span>
            A loaded cell fades the same way a waiting-cell ghost does, but for time already elapsed on its own
            108-hour clock rather than time left to wait - the closer this specific cell is to its own deadline, the
            paler it reads. Cells sharing a physical tray don&apos;t share a clock, so two slots from the same tray
            can shade differently.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Cell-link highlight (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} linkSource />
          </div>
          <span>The exact slot you&apos;re hovering or have pinned - a solid ring with a filled dot.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_PEER} slotIndex={4} linked />
          </div>
          <span>Another use of that same physical cell, wherever it lands on the calendar - a dashed ring with a hollow dot.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_UNRELATED} slotIndex={1} dimmed />
          </div>
          <span>An unrelated cell, softened so the linked slots stand out.</span>
        </div>
      </div>

      <p className={styles.subheading}>QC alert (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_ABORTED} slotIndex={0} />
          </div>
          <span>
            The whole run was aborted (an instrument/run problem, not this cell) - the mildest, amber/yellow ring;
            the sample has already gone back to the backlog.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_FAILED} slotIndex={0} />
          </div>
          <span>
            This use was marked Failed - an orange ring and label, one step more severe than Aborted; it produced
            no usable data, whether from Mark Failed or as the use a Stop cell was triggered from. The cell may
            still be fine for its other, earlier uses.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_STOPPED} slotIndex={0} />
          </div>
          <span>
            This slot&apos;s physical cell has been Stopped while this specific use hadn&apos;t recorded its own
            outcome yet - the most severe, red ring. Rare in practice: the use a Stop cell is triggered from always
            gets its own Failed outcome (see above), so this only shows up for a whole-cell Stop with no single use
            in view (from the Cell detail page, with no use currently in progress). A use that already finished,
            failed, or was cancelled by a stop keeps showing that instead (see the other examples here).
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_CANCELLED} slotIndex={0} />
          </div>
          <span>
            Blocked - this placement was cancelled before it ever ran and its sample is back in the Backlog. From a
            Stop cell it&apos;s a permanent marker; from a cell discard it can be cleared with Return to backlog (open
            the slot). Shares Stopped&apos;s red severity, with an added cross-hatch texture since it&apos;s the more
            actionable claim (a slot you might otherwise expect to still happen).
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Cell card, tray, and window meter (Cells &amp; Instruments, Cell detail)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <CellStatusCard cell={EXAMPLE_CELL_UNREPORTED} />
          </div>
          <span>
            A cell card: code, status badge, uses spent, current instrument/well, burned barcodes, a QC flag if one
            applies, and its 108-hour window meter.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <WindowMeter windowHours={112} />
          </div>
          <span>The same window meter once its 108-hour budget is breached - the fill turns red past the limit.</span>
        </div>
        <div className={styles.legendRow}>
          <TraySiblingList cells={EXAMPLE_TRAY_SIBLINGS} />
          <span>
            A physical tray&apos;s four sibling cells (Cell detail&apos;s &quot;Cell tray&quot; card, and the Cells
            tab&apos;s Open trays list) - each keeps its own independent status, since one cell&apos;s history can
            diverge from its tray-mates.
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

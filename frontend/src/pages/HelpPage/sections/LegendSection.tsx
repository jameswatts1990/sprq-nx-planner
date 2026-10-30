import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { CellStatusCard } from "@/components/cells/CellStatusCard";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { TraySiblingList } from "@/components/cells/TraySiblingList";
import { WindowMeter } from "@/components/cells/WindowMeter";
import {
  COMPLEX_COUNTDOWN_AMBER_DAYS,
  COMPLEX_COUNTDOWN_RED_DAYS,
  ComplexCountdownChip,
} from "@/components/shared/ComplexCountdownChip";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { InsertSizeFlag } from "@/components/shared/InsertSizeFlag";
import { MovieTimeFlag } from "@/components/shared/MovieTimeFlag";
import { UseLegend } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Note, type NoteTone } from "@/components/ui/Note";
import { CELL_STATUSES, CELL_USE_STATUSES, CYCLE_STATUSES, SAMPLE_STATUSES } from "@/types/common";
import type { CellStatus, CellUseStatus, CycleStatus, SampleStatus } from "@/types/common";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import type { CellQcFlag } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { CREDIT_OVERDUE_DAYS, NO_CELL_BADGE, OVERDUE_BADGE } from "@/utils/creditCase";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { priorityTone } from "@/utils/priority";
import { COMPLEX_REPEAT_WINDOW_DAYS } from "@/utils/qcDisposition";
import { SAMPLE_STATUS_LABEL, SAMPLE_STATUS_TONE } from "@/utils/sampleStatus";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "../HelpPage.module.css";
import {
  EXAMPLE_CELL_UNREPORTED,
  EXAMPLE_TRAY_SIBLINGS,
  STAGE_EXAMPLE_ABORTED,
  STAGE_EXAMPLE_BARCODE_CLASH,
  STAGE_EXAMPLE_CANCELLED,
  STAGE_EXAMPLE_FAILED,
  STAGE_EXAMPLE_PEER,
  STAGE_EXAMPLE_SMALL_INSERT_REUSE,
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
  cancelled: "The use was cancelled before it ever ran - e.g. a future use lost when its cell was Stopped or discarded; the sample returns to the backlog.",
};

const SAMPLE_STATUS_MEANING: Record<SampleStatus, string> = {
  backlog: "Imported and waiting to be scheduled.",
  scheduled: "Placed on the grid, but its run hasn't been confirmed loaded yet.",
  in_progress: "On a run that's been confirmed loaded and is sequencing.",
  completed: "The sample finished sequencing successfully.",
  failed: "The sample did not complete successfully.",
  cancelled: "Removed before it ever ran - cancelled from the backlog, or a placement blocked by a Cell QC action.",
};

const CELL_QC_FLAG_MEANING: Record<CellQcFlag, string> = {
  unreported: "The cell has a Failed use or is Stopped, and no PacBio case has been raised for it yet.",
  awaiting_credit: "The cell has been reported to PacBio, but the credit hasn't physically arrived in the lab yet.",
};
const CELL_QC_FLAGS: CellQcFlag[] = ["unreported", "awaiting_credit"];

/** A QC timestamp `n` days before now, so the legend renders the live countdown chip at each
 * colour band rather than re-describing its colours in prose. */
function qcDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
const COMPLEX_COUNTDOWN_EXAMPLES: { daysAgo: number; meaning: string }[] = [
  {
    daysAgo: 7,
    meaning: `A "Repeatable - from complex" sample: days left of the ${COMPLEX_REPEAT_WINDOW_DAYS}-day window, counted from the date its Cell QC was recorded, to use the leftover complex.`,
  },
  {
    daysAgo: COMPLEX_REPEAT_WINDOW_DAYS - COMPLEX_COUNTDOWN_AMBER_DAYS,
    meaning: `${COMPLEX_COUNTDOWN_AMBER_DAYS} days or fewer left - plan it in soon.`,
  },
  {
    daysAgo: COMPLEX_REPEAT_WINDOW_DAYS + 2,
    meaning: `${COMPLEX_COUNTDOWN_RED_DAYS} days or fewer left, or past the window ("d over"). A warning only - nothing is blocked or changed.`,
  },
];

// Priority is free text imported from the sample sheet (no fixed set of values), so
// these are illustrative examples - the colouring itself comes from the real
// priorityTone() function, keyed off the same "(N)" rank convention as the backend.
const PRIORITY_EXAMPLES: { label: string; meaning: string }[] = [
  {
    label: "Recoverable (0)",
    meaning: "Rank 0 - returned to the backlog by a Cell QC action as Recoverable - from instrument (the run's data can still be recovered from the instrument); shown in the Recoverable Samples section, above High.",
  },
  {
    label: "Repeatable (0)",
    meaning: "Rank 0 - returned to the backlog by a Cell QC action to be repeated, either from the leftover cleaned complex or from library material in Traction; shown in the Recoverable Samples section, above High.",
  },
  {
    label: "Aborted (0)",
    meaning: "Rank 0 - a legacy top-priority label given when a sample's run was aborted (an instrument/run problem) and it was bumped back to the backlog.",
  },
  { label: "High (1)", meaning: "Rank 1 - the most urgent standard priority." },
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

      <p className={styles.subheading}>Cell status (Cells, Cell detail)</p>
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

      <p className={styles.subheading}>QC / credit flags (Cells, Cell detail)</p>
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

      <p className={styles.subheading}>Credit case flag (QC)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={NO_CELL_BADGE.tone}>{NO_CELL_BADGE.label}</Badge>
          </span>
          <span>
            A PacBio credit case logged by hand on the QC tab, not linked to any cell - it never changes a cell, a sample
            or the schedule.
          </span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={OVERDUE_BADGE.tone}>{OVERDUE_BADGE.label} · 45 d</Badge>
          </span>
          <span>
            An open credit case that has made no progress for more than {CREDIT_OVERDUE_DAYS} days at its current
            stage - it needs chasing. The number is how long it has been waiting.
          </span>
        </div>
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

      <p className={styles.subheading}>Sample status (Backlog, Schedule, Sample detail)</p>
      <div className={styles.legendGrid}>
        {SAMPLE_STATUSES.map((s) => (
          <div className={styles.legendRow} key={s}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={SAMPLE_STATUS_TONE[s]}>{SAMPLE_STATUS_LABEL[s]}</Badge>
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

      <p className={styles.subheading}>Leftover-complex countdown (Backlog, Schedule, Sample detail)</p>
      <div className={styles.legendGrid}>
        {COMPLEX_COUNTDOWN_EXAMPLES.map((ex) => (
          <div className={styles.legendRow} key={ex.daysAgo}>
            <span className={styles.legendSwatchLabel}>
              <ComplexCountdownChip qcDisposition="repeatable_complex" qcDispositionAt={qcDaysAgo(ex.daysAgo)} />
            </span>
            <span>{ex.meaning}</span>
          </div>
        ))}
      </div>

      <p className={styles.subheading}>Duplicate samples (Backlog, Schedule, History, Sample detail)</p>
      <div className={styles.legendRow}>
        <span className={styles.legendSwatchLabel}>
          <DuplicateBadge index={1} total={3} />
        </span>
        <span>
          The same Pool ID appears on more than one sample - the same sample deliberately run
          across multiple SMRT cells. &ldquo;1/3&rdquo; means this is copy 1 of 3 (counted across
          every status, including completed runs). Distinct from the cell &ldquo;Use 1/2/3&rdquo;
          colours above, which count acquisitions of one physical cell.
        </span>
      </div>
      <div className={styles.legendRow}>
        <span className={styles.legendSwatchLabel}>
          <DuplicateBadge index={2} total={3} selfReuse />
        </span>
        <span>
          On the weekly schedule only: the ↻ means this copy is sharing a physical cell with an
          earlier copy of the same Pool ID. That&apos;s allowed and expected - it&apos;s the
          same underlying sample either way, so there&apos;s no risk of one sample&apos;s reads
          being mixed up with another&apos;s. Opening the slot shows the same explanation.
        </span>
      </div>

      <p className={styles.subheading}>Small insert flag (Backlog, Schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <InsertSizeFlag sizeBp={3000} />
          </span>
          <span>
            The sample&apos;s insert / fragment size is at or below the small-insert threshold (set in Admin →
            Scheduling, default 5&nbsp;kb). Small inserts lose yield when a SMRT cell is re-used, so Auto Schedule
            keeps them on a cell&apos;s first use, and a warning shows if one is placed manually on a 2nd/3rd use. The
            tag text tracks the configured threshold.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_SMALL_INSERT_REUSE} slotIndex={4} />
          </div>
          <span>
            On the weekly schedule, a small-insert sample on a cell&apos;s <b>2nd/3rd use</b> (the case that actually
            costs yield) gets the bolder hazard-striped stripe across the top of its card, shown here, so the at-risk
            reuse is visible at a glance without reading the small tag text. On a <b>first use</b> the card carries only
            the flag, no stripe.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Movie time &amp; non-default settings flag (Backlog, Schedule, Batch Sheet)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <MovieTimeFlag hours={12} />
          </span>
          <span>
            The sample (or, on the schedule, that one cell) runs a movie time other than the default set in{" "}
            <b>Settings → Movie scheduling</b> (normally 24&nbsp;h), so short and long runs stand out at a glance. Hover
            it to see which cell Auto Schedule loads that length on. It&apos;s information only - nothing is blocked.
          </span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <MovieTimeFlag hours={30} />
          </span>
          <span>The same flag for a 30&nbsp;h movie. A default-length movie shows no flag.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone="ink">Kinetics True</Badge>
          </span>
          <span>
            On the <b>Batch Sheet</b>, the same dark chip marks any well setting that differs from{" "}
            <b>Settings → Sample defaults</b>, which you&apos;ll need to change in that well&apos;s Traction form.
            Hover it to see the default.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Use colours (schedule barcode chips)</p>
      <div className={styles.legendRow}>
        <UseLegend />
        <span>
          Which acquisition of a cell a card, seal or barcode belongs to — or indigo for a single-use SPRQ cell, which
          only ever runs once.
        </span>
      </div>

      <p className={styles.subheading}>Cell type (Schedule, Cells)</p>
      <div className={styles.legendRow}>
        <span className={styles.legendSwatchLabel}>
          <CellTypeBadge cellType="sprq" />
        </span>
        <span>
          A run, tray or cell on single-use <b>SPRQ</b> cells (chosen on the load-time dial when the run was started).
          Multi-use SPRQ-Nx — the everyday type — carries no badge.
        </span>
      </div>

      <p className={styles.subheading}>Slot shading (Weekly schedule)</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE} slotIndex={0} />
          </div>
          <span>
            A loaded cell gradually pales as time elapses on its own 108-hour clock - the closer this specific cell is
            to its deadline, the paler it reads. Cells sharing a physical tray don&apos;t share a clock, so two slots
            from the same tray can shade differently.
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
            Blocked - this placement was cancelled before it ever ran and its sample is back in the Backlog. Open the
            slot to clear it (Clear slot after a Stop cell, Return to backlog after a cell discard) and free the well.
            Shares Stopped&apos;s red severity, with an added cross-hatch texture since it&apos;s the more
            actionable claim (a slot you might otherwise expect to still happen).
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_BARCODE_CLASH} slotIndex={0} />
          </div>
          <span>
            Barcode clash - the most severe marking, outranking every other QC alert. This cell has burned this exact
            barcode with a <b>different</b> sample, so the two can&apos;t be reliably told apart in the sequencing
            output. Most often this is a manual drop or move that landed on the tray&apos;s next cell in loading order
            (cells are always taken in sequence - a barcode clash is never a reason to skip one), rather than being
            silently rerouted; it can also come from a rarer Cell QC tray re-zip. It appears as soon as the drop
            lands (there&apos;s no warning while dragging, since the cell is chosen after the drop). Pulses so
            it&apos;s never missed - check the clashing cell and its slot detail before this run proceeds.
          </span>
        </div>
      </div>

      <p className={styles.subheading}>Cell card, tray, and window meter (Cells, Cell detail)</p>
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
            A physical tray&apos;s four sibling cells, the compact list shown in the Schedule grid&apos;s cell popover -
            each keeps its own independent status, since one cell&apos;s history can diverge from its tray-mates. (On the
            Cells tab and a cell&apos;s detail page a tray&apos;s cells are shown as the full cell cards above instead.)
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

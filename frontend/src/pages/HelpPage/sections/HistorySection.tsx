import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { Badge } from "@/components/ui/Badge";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";

import styles from "../HelpPage.module.css";
import { STAGE_EXAMPLE_SOURCE } from "./helpFixtures";

export function HistorySection() {
  return (
    <div className={styles.copy}>
      <p className={styles.subheading}>History → Runs</p>
      <p>
        <b>What it&apos;s for:</b> a searchable record of every sequencing run (past, active, and planned). Filter
        by status, instrument, and a date range, or type in the search box to match by id, run name, instrument,
        status, or date. Long histories are shown a page at a time — choose how many rows per page and use the
        <b> Previous</b>/<b>Next</b> buttons below the table to move through them.
      </p>
      <p>
        <b>Columns:</b> Run (its name if one was given when it was locked via <b>Confirm loaded</b>, otherwise its
        number, shown as <b>#45</b>; links to detail), Load date, Instrument, Status badge, number of Plates (1 or 2), Movie length
        in hours (its longest plate), number of Cells in the run, and the planned start time.
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.planned}>planned</Badge>
          </span>
          <span>Scheduled but not yet loaded.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.running}>running</Badge>
          </span>
          <span>Confirmed loaded / currently sequencing.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.completed}>completed</Badge>
          </span>
          <span>The run has finished.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.aborted}>aborted</Badge>
          </span>
          <span>The run was stopped or cancelled.</span>
        </div>
      </div>
      <p>
        <b>Run detail page</b> shows the run&apos;s instrument, load date, when it loads &amp; starts sequencing,
        status, and whether it&apos;s <b>Active now</b>, then a tray block per plate laid out just like the weekly
        schedule. Each plate&apos;s header carries a <b>reuse</b> marker when it reruns Plate 1&apos;s cells, an{" "}
        <b>→ acquire-day</b> tag when the plate sequences on a different day from loading, the planned start → end of
        its movie, and — once the run has actually run — the <b>actual</b> start/end recorded on the instrument. Each
        plate&apos;s four wells are drawn with the same colour-coded cards used on the schedule:
      </p>
      <div className={styles.ghostExampleSwatch}>
        <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} locked onOpenCell={() => {}} />
      </div>
      <p>
        <b>Click a card</b> to see that placement&apos;s detail (sample, well, run time, barcodes, notes). Click the
        shiny <b>cell stub</b> on the right edge of a card to open the physical cell — its uses so far, its 108-hour
        window, tray position, and burned barcodes — and from either you can open <b>Cell QC</b> to record how a use
        turned out. On a finished run these views are read-only; on a still-<i>planned</i> run you can adjust a
        cell&apos;s run time or switch a reuse to a fresh cell, exactly as on the schedule.
      </p>
      <p>
        <b>Cancel run</b> is available only while a run is still <i>planned</i>; once it&apos;s running/loaded it
        can&apos;t be cancelled from here.
      </p>

      <p className={styles.subheading}>History → Samples</p>
      <p>
        <b>What it&apos;s for:</b> every sample that has finished, either <b>completed</b> (green) or <b>failed</b>{" "}
        (red). Search by Container ID, barcode, or parent sample. Each row shows the sample&apos;s <b>Container ID</b>,
        status, barcodes, parent sample, Target OPLC, volume, priority, and last-updated time. Click <i>any</i> column
        header to sort the list by that field (click again to reverse); it starts with the most recently updated
        first, and long lists are paged with the same <b>Previous</b>/<b>Next</b> control. Click a row to expand it
        and see that sample&apos;s individual cell uses — the run (links to the run), which plate (1 or 2) it ran on,
        the cell (links to the cell) and well, the use status as a colour-coded badge, start/complete times, and
        notes. That inner cell-uses table has clickable, sortable headers too.
      </p>

      <p className={styles.subheading}>Sample detail page</p>
      <p>
        <b>What it&apos;s for:</b> a single sample (container) on its own page, reached by clicking a <b>container ID</b>{" "}
        anywhere in the app — a cell card, a cell&apos;s use history. It shows the sample&apos;s full metadata (parent
        sample, priority, Target OPLC, volume, movie time, loading options, barcodes, Sanger IDs, created/updated times) and a{" "}
        <b>Cell uses</b> table of every cell it has been placed on — the run (links to the run), plate, cell (links to
        the cell), well, use status, start/complete times, and notes. Unlike the Samples list above, which only lists
        finished samples, this page works for a sample of any status, so it&apos;s the durable place a container ID
        always links to.
      </p>
      <p>
        <b>Back:</b> the link at the top left returns you to wherever you opened the sample from — the Backlog,
        Schedule, a cell, a run, or the Samples list — rather than always to one fixed place. Opening the page directly (a
        shared link or a browser refresh) falls back to the Samples list.
      </p>
      <p>
        <b>Edit:</b> an <b>Edit</b> button next to the status badge opens the same form used elsewhere. A backlog
        sample is fully editable (everything but its container ID, which is fixed for life); a sample already placed on
        the grid (scheduled or in progress) lets you adjust only its loading parameters, since its barcodes and
        identity are locked once placed. Finished samples (completed, failed, cancelled) are read-only history, so no
        Edit button is shown.
      </p>
    </div>
  );
}

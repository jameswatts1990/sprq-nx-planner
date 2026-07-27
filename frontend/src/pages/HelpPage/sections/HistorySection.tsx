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
        plain number; links to detail), Load date, Instrument, Status badge, number of Plates (1 or 2), Movie length
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
      </div>
      <p>
        <b>Run detail page</b> shows the run&apos;s instrument, load date, status, and whether it&apos;s{" "}
        <b>Active now</b>, then a block per plate (Plate 1, and Plate 2 if the run has one) with that plate&apos;s
        acquisition date, movie length, and a <b>reuse</b> marker when it reruns Plate 1&apos;s cells. Each
        plate&apos;s four wells are drawn with the same colour-coded view used on the schedule:
      </p>
      <div className={styles.ghostExampleSwatch}>
        <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} locked />
      </div>
      <p>
        <b>Cancel run</b> is available only while a run is still <i>planned</i>; once it&apos;s running/loaded it
        can&apos;t be cancelled from here.
      </p>

      <p className={styles.subheading}>History → Samples</p>
      <p>
        <b>What it&apos;s for:</b> every sample that has finished, either <b>completed</b> (green) or <b>failed</b>{" "}
        (red). Search by container ID, barcode, or parent sample. Each row shows the sample&apos;s status, barcodes,
        parent sample, Target OPLC, volume, and last-updated time. Click a row to expand it and see that sample&apos;s
        individual cell uses — the run, which plate (1 or 2) it ran on, the cell and well, the use status,
        start/complete times, and notes.
      </p>

      <p className={styles.subheading}>Sample detail page</p>
      <p>
        <b>What it&apos;s for:</b> a single sample (container) on its own page, reached by clicking a <b>container ID</b>{" "}
        anywhere in the app — a cell card, a cell&apos;s use history. It shows the sample&apos;s full metadata (parent
        sample, priority, Target OPLC, volume, loading options, barcodes, Sanger IDs, created/updated times) and a{" "}
        <b>Cell uses</b> table of every cell it has been placed on — the run (links to the run), plate, cell (links to
        the cell), well, use status, start/complete times, and notes. Unlike the Samples list above, which only lists
        finished samples, this page works for a sample of any status, so it&apos;s the durable place a container ID
        always links to.
      </p>
    </div>
  );
}

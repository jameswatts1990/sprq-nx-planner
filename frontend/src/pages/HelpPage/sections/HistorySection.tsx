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
        status, or date.
      </p>
      <p>
        <b>Columns:</b> Run (its name if one was given when it was locked via <b>Confirm loaded</b>, otherwise its
        plain number; links to detail), Run date, Instrument, Status badge, Movie length in hours, number of Cells
        in the run, and the planned start time.
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
        <b>Run detail page</b> shows the run&apos;s instrument, date, status, whether it&apos;s <b>Active now</b>,
        its movie length, and its planned start → end times. Its up-to-eight slots are drawn with the same
        colour-coded view used on the schedule:
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
        (red). Search by external ID, barcode, or parent sample. Each row shows the sample&apos;s status, barcodes,
        parent sample, OPLC, volume, and last-updated time. Click a row to expand it and see that sample&apos;s
        individual cell uses — which cell and well, the use status, start/complete times, and notes.
      </p>
    </div>
  );
}

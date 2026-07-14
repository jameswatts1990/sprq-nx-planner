import styles from "../HelpPage.module.css";

export function HistorySection() {
  return (
    <div className={styles.copy}>
      <p className={styles.subheading}>History → Runs</p>
      <p>
        <b>What it&apos;s for:</b> a searchable record of every sequencing run (past, active, and planned). Filter
        by status, instrument, and a date range, or type in the search box to match by id, instrument, status, or
        date.
      </p>
      <p>
        <b>Columns:</b> Run (number, links to detail), Run date, Instrument, Status badge, Movie length in hours,
        number of Cells in the run, and the planned start time.
      </p>
      <p>
        <b>Run detail page</b> shows the run&apos;s instrument, date, status, whether it&apos;s <b>Active now</b>,
        its movie length, and its planned start → end times. Its up-to-four slots are drawn with the same
        colour-coded view used on the schedule. <b>Cancel run</b> is available only while a run is still{" "}
        <i>planned</i>; once it&apos;s running/loaded it can&apos;t be cancelled from here.
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

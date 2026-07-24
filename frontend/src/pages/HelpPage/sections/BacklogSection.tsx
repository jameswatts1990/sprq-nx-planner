import { Badge } from "@/components/ui/Badge";
import { ABORTED_PRIORITY, priorityTone } from "@/utils/priority";

import styles from "../HelpPage.module.css";

const PRIORITY_EXAMPLES = [ABORTED_PRIORITY, "High (1)", "Medium (2)", "Standard (3)"];

export function BacklogSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> every sample that has been imported but not yet placed on the schedule. The
        count in the header is the total waiting.
      </p>

      <p className={styles.subheading}>Filters &amp; search</p>
      <p>
        <b>Search</b> by external ID, barcode, parent sample, or priority; results narrow as you type. Use the{" "}
        <b>priority dropdown</b> to narrow the list to one priority value. The <b>rows-per-page</b> control (25 /
        50 / 100 / 200, defaulting to 50) sets how many samples are shown at once.
      </p>

      <p className={styles.subheading}>Columns &amp; sorting</p>
      <p>
        <b>Columns:</b> Container ID, Barcodes, Parent sample, Sanger IDs, Priority, Target OPLC, and Created (when
        it was imported). A dash (—) means that field is empty for the sample.
      </p>
      <p>
        <b>Sorting:</b> click the <b>Container ID</b>, <b>Barcodes</b>, or <b>Priority</b> column header to sort by
        that field; click again to reverse the direction. An arrow (▲/▼) on the header shows the active sort and
        direction. Priority sorts by rank (High before Standard), not alphabetically.
      </p>
      <p>
        <b>Priority</b> shows as a coloured badge so the most urgent samples stand out at a glance, both here and
        on the draggable cards in the Schedule tab&apos;s Backlog panel:
      </p>
      <div className={styles.legendGrid}>
        {PRIORITY_EXAMPLES.map((p) => (
          <div className={styles.legendRow} key={p}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={priorityTone(p)}>{p}</Badge>
            </span>
          </div>
        ))}
      </div>
      <p>
        <b>Aborted</b> is a special priority set automatically, not by a lab user: when a <b>Stop cell</b> QC action
        (see the Schedule and Cells tabs&apos; help) cancels a cell&apos;s later, not-yet-run uses, each of those
        samples is returned here with its priority set to <b>Aborted</b> — the highest rank there is, so it always
        sorts to the very top of the Backlog. Rescuing one is no different from scheduling any other backlog sample:
        drag it (or place it via Auto Schedule) onto a different cell.
      </p>
      <p>
        Whenever one or more Aborted samples are waiting, a red <Badge tone="danger">⚠ N aborted</Badge> warning
        badge appears next to the sample count in this tab&apos;s header and in the Schedule tab&apos;s Backlog
        panel header — visible even while that panel is collapsed — so a scheduler never misses one sitting
        unrescued in the queue.
      </p>

      <p className={styles.subheading}>Actions</p>
      <p>
        <b>+ Add sample</b> (top-right of the toolbar) opens a form to add one sample to the backlog by hand — handy
        when a sample isn&apos;t in a file to import. <b>Container ID</b> and at least one <b>barcode</b>{" "}
        are required (enter several barcodes separated by commas or spaces); every other field is optional. The
        three True/False settings (Adaptive Loading, Full-Resolution Base Q, Include Base Kinetics) are chosen from a
        dropdown. The new sample lands in the backlog exactly like an imported one. If the Container ID already
        belongs to an active sample, the form says so and nothing is added.
      </p>
      <p>
        <b>Edit</b> (on each row) opens the same form to correct a backlog sample&apos;s details — barcodes, Sanger
        IDs, priority, Target OPLC, and the other settings. The <b>Container ID</b> is greyed out and can&apos;t be
        changed: it identifies the sample and is fixed once created. Editing is only offered while a sample is still
        in the backlog; once it&apos;s scheduled its details are locked.
      </p>
      <p>
        <b>Cancel</b> (on each row) removes a sample from the backlog when you never intend to sequence it. Use it
        to clear out mistakes or withdrawn samples; it does not delete sequencing history. If a cancel fails, a red
        note explains why.
      </p>
      <p>
        The same backlog also appears as draggable cards inside the Schedule tab&apos;s Backlog panel, with the same
        search, priority, sort, and rows-per-page controls (sort there is a dropdown plus a direction button rather
        than clickable column headers, since that panel is a card list, not a table). You rarely need to cancel from
        there during normal planning.
      </p>
    </div>
  );
}

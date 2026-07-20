import { Badge } from "@/components/ui/Badge";
import { priorityTone } from "@/utils/priority";

import styles from "../HelpPage.module.css";

const PRIORITY_EXAMPLES = ["High (1)", "Medium (2)", "Standard (3)"];

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
        <b>Columns:</b> External ID, Barcodes, Parent sample, Sanger IDs, Priority, Target OPLC, and Created (when
        it was imported). A dash (—) means that field is empty for the sample.
      </p>
      <p>
        <b>Sorting:</b> click the <b>External ID</b>, <b>Barcodes</b>, or <b>Priority</b> column header to sort by
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

      <p className={styles.subheading}>Actions</p>
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

import styles from "../HelpPage.module.css";

export function BacklogSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> every sample that has been imported but not yet placed on the schedule. The
        count in the header is the total waiting.
      </p>
      <p>
        <b>Search</b> by external ID, barcode, or parent sample; results narrow as you type. The list is paged 25
        at a time.
      </p>
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
        <b>Cancel</b> (on each row) removes a sample from the backlog when you never intend to sequence it. Use it
        to clear out mistakes or withdrawn samples; it does not delete sequencing history. If a cancel fails, a red
        note explains why.
      </p>
      <p>
        The same backlog also appears as draggable cards inside the Schedule tab, so you rarely need to cancel from
        here during normal planning.
      </p>
    </div>
  );
}

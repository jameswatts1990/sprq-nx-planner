import { Note } from "@/components/ui/Note";

import styles from "../HelpPage.module.css";

export function ImportSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> loading a batch of samples and their barcodes into the planner. Imported
        samples appear in the Backlog, ready to schedule.
      </p>

      <p className={styles.subheading}>Step 1 — paste or upload</p>
      <p>
        <b>Any column layout works.</b> Paste your LIMS export, a sequencing-tracker sheet, or any CSV — you match
        the columns to fields on the next step, so the headers don&apos;t have to be named a particular way. Each
        Barcodes cell may hold one or several codes.
      </p>
      <dl className={styles.terms}>
        <dt>Upload CSV</dt>
        <dd>Pick a .csv, .tsv, or .txt file from your computer; its contents fill the box.</dd>
        <dt>Load example data</dt>
        <dd>Fills the box with a sample batch so you can see the expected shape.</dd>
        <dt>Download template</dt>
        <dd>Saves a blank CSV with the right column headers and one example row — fill it in and upload it back.</dd>
        <dt>First row is a header</dt>
        <dd>
          Leave ticked for normal CSVs (the first line names the columns). Untick it for a bare two-column list of{" "}
          <i>sample ID, barcodes</i> with no header line.
        </dd>
        <dt>Continue to mapping →</dt>
        <dd>Reads the file (without importing yet) and takes you to the column-matching step.</dd>
        <dt>Filename (optional)</dt>
        <dd>A label stored with the batch (e.g. batch-2026-07.csv); purely for your own reference.</dd>
      </dl>

      <p className={styles.subheading}>Step 2 — review columns</p>
      <p>
        Each field (Traction / External ID, Barcodes, Sanger IDs, Plate ID, priority, loading concentrations…) has a
        dropdown where you pick which column of your file feeds it. The planner <b>pre-fills its best guess</b>, so
        usually you just glance and confirm; correct any that are wrong, or set one to <i>“— not imported —”</i>. A
        live preview of the first rows shows exactly what will be imported, and the mapping updates it as you change
        a dropdown. Fields marked <span aria-hidden>*</span> are required — <b>Traction / External ID</b> and{" "}
        <b>Barcodes</b> must be mapped before the <b>Import</b> button enables. Rows with no barcode are skipped, and
        a note tells you how many. Use <b>‹ Back</b> to return to the text without losing it.
      </p>

      <p className={styles.subheading}>Result panel</p>
      <p>
        <b>After importing, the result panel shows four numbers:</b>
      </p>
      <dl className={styles.terms}>
        <dt>Rows read</dt>
        <dd>Lines the server parsed from your input.</dd>
        <dt>Imported</dt>
        <dd>New samples added to the Backlog.</dd>
        <dt>Duplicates</dt>
        <dd>Rows whose Traction ID already matched an active sample, so they were not added again.</dd>
        <dt>Skipped</dt>
        <dd>Rows that parsed but weren&apos;t imported — usually because they had no barcode.</dd>
      </dl>
      <p>
        Two tables make skipped and duplicate rows <b>actionable</b>: the <b>Skipped rows</b> table lists each
        sample ID and why it was skipped (e.g. &quot;No barcodes&quot;) so you can fix the source and re-import, and
        the <b>Duplicates</b> table lists each External ID that already existed. Use <b>Import another file</b> to
        start over, or <b>View backlog →</b> to jump to the newly imported samples.
      </p>
      <div className={styles.noteExamples}>
        <Note tone="warn" icon="!">
          <b>Warnings</b> (amber) flag rows that need attention.
        </Note>
        <Note tone="bad" icon="!">
          A red note means the import failed entirely (for example a server error) — fix it and try again.
        </Note>
      </div>
    </div>
  );
}

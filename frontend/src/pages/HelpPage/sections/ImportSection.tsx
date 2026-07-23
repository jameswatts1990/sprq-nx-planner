import { Note } from "@/components/ui/Note";

import styles from "../HelpPage.module.css";

export function ImportSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> loading a batch of samples and their barcodes into the planner. Imported
        samples appear in the Backlog, ready to schedule.
      </p>

      <p className={styles.subheading}>Accepted formats</p>
      <p>
        <b>Three formats are accepted.</b> You can paste your full LIMS export (with the{" "}
        <i>Container, Parent Sample, Sanger Sample IDs, Barcodes, Volume to Load, Actual OPLC…</i> columns), or a
        simple two-column list of <i>sample ID, barcodes</i>. The Barcodes column may hold one or several codes per
        row.
      </p>
      <p>
        You can also paste rows straight from the <b>sequencing tracker</b> Google Sheet. The planner recognises
        that layout automatically and maps the columns it understands — Traction ID, barcodes (from the{" "}
        <i>Complex Batch ID</i> column), Sanger Sample ID, Plate ID, loading concentrations, priority and CCS
        kinetics. Only rows marked <b>Pending</b> (or with a blank status) are added to the Backlog; rows already{" "}
        <i>In Progress</i> or <i>Loaded</i> are on the instrument and are skipped (each is listed as a warning). The
        sheet&apos;s blank separator and label rows are ignored. When a tracker paste is detected you&apos;ll see a
        note saying so in the result panel.
      </p>
      <dl className={styles.terms}>
        <dt>Upload CSV</dt>
        <dd>Pick a .csv, .tsv, or .txt file from your computer; its contents fill the box.</dd>
        <dt>Load example data</dt>
        <dd>Fills the box with a sample batch so you can see the expected shape.</dd>
        <dt>Clear</dt>
        <dd>Empties the box and resets the result panel.</dd>
        <dt>Import samples</dt>
        <dd>Sends the data to the server. Disabled until there&apos;s text to import; reads &quot;Importing…&quot; while it runs.</dd>
        <dt>Filename (optional)</dt>
        <dd>A label stored with the batch (e.g. batch-2026-07.csv); purely for your own reference.</dd>
      </dl>
      <p>
        The line/character counter under the box is only a rough check that text was pasted. The real parsing
        happens on the server when you press Import — so the counts don&apos;t guarantee a row will import cleanly.
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
        <dd>Rows that matched a sample already in the system, so they were not added again.</dd>
        <dt>Skipped</dt>
        <dd>Rows that were not imported for another reason.</dd>
      </dl>

      <p className={styles.subheading}>Warnings &amp; rejected rows</p>
      <div className={styles.noteExamples}>
        <Note tone="warn" icon="!">
          <b>Warnings</b> (amber) flag rows that imported but need attention.
        </Note>
        <Note tone="info" icon="i">
          If nothing imported and there were no warnings or rejects, you&apos;ll see &quot;No rows were
          imported.&quot;
        </Note>
        <Note tone="bad" icon="!">
          A red note means the import failed entirely (for example a server error) — the message describes what
          went wrong; fix it and try again.
        </Note>
      </div>
      <p>
        The <b>Rejected table</b> lists each row that could not be imported, with its External ID and the reason.
        Use <b>View backlog →</b> to jump to the newly imported samples.
      </p>
    </div>
  );
}

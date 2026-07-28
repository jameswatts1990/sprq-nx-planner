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
        <dt>Upload from scheduler (the ▾ arrow)</dt>
        <dd>
          Click the small arrow beside <b>Upload CSV</b> and choose <b>Upload from scheduler…</b> to load your
          scheduling sheet directly, as either a <b>.csv</b> or an <b>.xlsx</b> Excel file — no need to rename or
          rearrange columns first. The planner reads the sheet&apos;s <i>Portion of SMRT Cell</i> column and{" "}
          <b>pools</b> the rows that share a cell into one container (Pool ID becomes the Container ID; barcodes and
          Sanger IDs are combined). It then takes you straight to the mapping step with a note saying how many rows
          became how many containers, plus a warning for any group that didn&apos;t add up to a whole cell (those
          are left out). A Plate ID column, if present, is ignored — the planner doesn&apos;t track it. The
          complex-loading dilution volumes on the sheet — cleaned-complex and loading-buffer —
          are carried across automatically and later pre-fill the batch sheet&apos;s loading-dilution worksheet
          (Control Dilution 3 is always 1 µL, printed on the batch sheet).
        </dd>
        <dt>Download template</dt>
        <dd>Saves a blank CSV with the right column headers and one example row — fill it in and upload it back.</dd>
        <dt>First row is a header</dt>
        <dd>
          Leave ticked for normal CSVs (the first line names the columns). Untick it for a bare two-column list of{" "}
          <i>sample ID, barcodes</i> with no header line.
        </dd>
        <dt>Continue to mapping</dt>
        <dd>Reads the file (without importing yet) and takes you to the column-matching step.</dd>
        <dt>Filename (optional)</dt>
        <dd>A label stored with the batch (e.g. batch-2026-07.csv); purely for your own reference.</dd>
        <dt>Clear</dt>
        <dd>Empties the paste box and filename so you can start fresh.</dd>
      </dl>

      <p className={styles.subheading}>Step 2 — review columns</p>
      <p>
        Each field (Container ID, Barcodes, Sanger Sample IDs, Target OPLC, priority, Movie time, True/False settings…) has a
        dropdown where you pick which column of your file feeds it. The planner <b>pre-fills its best guess</b>, so
        usually you just glance and confirm; correct any that are wrong, or set one to <i>“— not imported —”</i>. A
        live preview of the first rows shows exactly what will be imported, and the mapping updates it as you change
        a dropdown. Fields marked <span aria-hidden>*</span> are required — <b>Container ID</b> and{" "}
        <b>Barcodes</b> must be mapped before the <b>Import</b> button enables. Rows with no barcode are skipped, and
        a note tells you how many. Use <b>Back</b> to return to the text without losing it.
      </p>
      <p>
        A few fields — the complex-loading volumes (<i>cleaned-complex</i> and <i>loading-buffer</i>) — are optional
        and used only on the batch sheet&apos;s loading-dilution worksheet. You can map them here, and you can also
        fill them in (or correct them) later on the manual <i>Add / Edit sample</i> form. Leave them unmapped if your
        file doesn&apos;t have them.
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
        <dd>Rows whose Container ID already matched an active sample, so they were not added again.</dd>
        <dt>Skipped</dt>
        <dd>Rows that parsed but weren&apos;t imported — usually because they had no barcode.</dd>
      </dl>
      <p>
        Two tables make skipped and duplicate rows <b>actionable</b>: the <b>Skipped rows</b> table lists each
        sample ID and why it was skipped (e.g. &quot;No barcodes&quot;) so you can fix the source and re-import, and
        the <b>Duplicates</b> table lists each Container ID that already existed. Use <b>Import another file</b> to
        start over, or <b>View backlog</b> to jump to the newly imported samples.
      </p>
      <div className={styles.noteExamples}>
        <Note tone="warn" icon="!">
          <b>Warnings</b> (amber) flag rows that need attention.
        </Note>
        <Note tone="bad" icon="!">
          A red note means the import failed entirely (for example a server error) — fix it and try again.
        </Note>
      </div>

      <p className={styles.subheading}>Undo an import</p>
      <p>
        Imported the wrong file, or picked the wrong columns? You can <b>undo the most recent import</b> — it removes
        every sample that import added and clears the batch, as if it never happened.
      </p>
      <dl className={styles.terms}>
        <dt>Where to find it</dt>
        <dd>
          <b>Undo import</b> sits on the result panel right after importing, and — for as long as it&apos;s still
          available — in a <b>Last import</b> banner at the top of this tab when you come back to it. Either opens a
          short confirmation before anything is removed.
        </dd>
        <dt>When it&apos;s allowed</dt>
        <dd>
          Only the <b>single most recent</b> import can be undone, and only while <b>none of its samples have been
          touched</b> — nothing scheduled onto a run, cancelled, edited, flagged in Cell QC, or given a top-up. As
          soon as you start working with the imported samples, undo is no longer offered (the banner disappears), so
          it can never quietly discard work already in progress. Importing again afterwards makes that new batch the
          one you can undo.
        </dd>
        <dt>Can I redo it?</dt>
        <dd>No — undo permanently removes the samples. To bring them back, import the file again.</dd>
      </dl>
    </div>
  );
}

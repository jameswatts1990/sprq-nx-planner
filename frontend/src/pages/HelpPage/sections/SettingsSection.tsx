import { Note } from "@/components/ui/Note";

import styles from "../HelpPage.module.css";

export function SettingsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> configure how this copy of the app behaves — the loading options given to new
        samples, the scheduling rules Auto Schedule follows, and the credit email — and see the fixed instrument facts
        the app enforces. A left-hand list switches between sections; the search box filters it. The raw database tools
        (for development use only) are tucked away behind <b>Show developer tools</b> at the bottom of the list.
      </p>

      <p className={styles.subheading}>Sample defaults</p>
      <p>
        Sets the default loading options given to a new sample: <b>Adaptive Loading</b>, <b>Full-Resolution Base Q</b>,{" "}
        <b>Include Base Kinetics</b> (each True or False) and <b>Priority</b> (Standard / Medium / High). Pick a value
        per field and press <b>Save defaults</b>. These pre-fill the Backlog&apos;s <b>Add sample</b> form and fill in
        any of these four fields left blank when a sample is imported. Existing samples are never changed; only samples
        created afterwards use the new defaults.
      </p>

      <p className={styles.subheading}>Scheduling</p>
      <p>
        Global rules. The <b>insert-size re-use threshold</b> (in base pairs, default 5000): a library whose insert
        size is at or below this is treated as <b>small-insert</b> — it carries a <b>[&lt;5kb]</b> flag, Auto Schedule
        keeps it on a SMRT cell&apos;s first use, and a warning shows if it&apos;s placed by hand on a re-use. The{" "}
        <b>default run start hour</b>: the time of day a run loads by default, which pre-fills the load-time dial on the
        Schedule grid. Two <b>cleaned complex</b> volumes drive the Cell QC repeat-from-complex decision: the total{" "}
        <b>cleaned complex made</b> per sample (default 24 µL) and the <b>safe repeat-from-complex volume</b> (default
        12 µL) — when at least that much complex is left after loading, Cell QC suggests a repeat straight from complex;
        below it the repeat is flagged “at risk” (never blocked). Change a value and press <b>Save</b>. Existing
        schedules are unaffected until they&apos;re re-run.
      </p>

      <p className={styles.subheading}>Movie scheduling</p>
      <p>
        Controls the movie (acquisition) lengths. The available lengths — <b>12 / 24 / 30 h</b> — are fixed instrument
        options and can&apos;t be changed here (see <b>Instrument &amp; scheduling facts</b>). What you can set is which
        length is the <b>default</b> for a sample that doesn&apos;t specify one, and, per length, which <b>carousel
        cell</b> Auto Schedule confines it to (for example 12 h on cell 1, 30 h on cell 4, 24 h any cell). These steer
        Auto Schedule only — a manual drag-and-drop always places a sample wherever you drop it. Press <b>Save</b> to
        apply; existing schedules are unaffected until re-run.
      </p>

      <p className={styles.subheading}>Email template</p>
      <p>
        Customises the one email the app sends: the PacBio credit request opened by <b>Generate email…</b> on a failed
        cell&apos;s credit case. Edit the <b>To</b>, <b>Cc</b>, <b>Subject</b> and <b>Body</b>, then press{" "}
        <b>Save email template</b>. To drop in a value that changes per case — the sample name, run, and so on — click
        one of the <b>Insert variable</b> chips and it&apos;s added where your cursor is. Each variable (in angle
        brackets, e.g. <code>&lt;sample name&gt;</code>) is replaced with the real value from the failing cell when the
        email is generated. The <b>Preview</b> underneath shows the whole email filled in with example values and lists
        what each variable stands for.
      </p>
      <p>
        One variable is worked out for you: <code>&lt;reimbursement&gt;</code> is the{" "}
        <b>expected number of acquisitions to credit</b> — the failed acquisition plus the cell&apos;s remaining
        acquisitions. Two variables — <code>&lt;well&gt;</code> and <code>&lt;cell code&gt;</code> — are this
        app&apos;s internal tray/cell identifiers, which PacBio&apos;s support desk won&apos;t recognise; leave them out
        of an email going to PacBio and identify the cell by its sample and run instead.
      </p>

      <p className={styles.subheading}>Instrument &amp; scheduling facts</p>
      <p>
        A read-only reference of the rules the app enforces that come from the PacBio Revio / SPRQ-Nx instrument itself,
        grouped into cell reuse (the <b>108-hour re-use window</b>, the <b>3-use</b> cap, the <b>tray of 4</b>), the
        instrument deck (its <b>8 loading wells</b> and the <b>12 / 24 / 30 h</b> movie lengths), and the per-cell
        timing ladder (prep, re-use wash, sequencing and PPA lanes, and so on). These are physical or vendor-documented
        facts, not preferences, so they&apos;re shown for reference but can&apos;t be edited.
      </p>

      <p className={styles.subheading}>Developer tools</p>
      <p>
        Click <b>Show developer tools</b> at the bottom of the section list to reveal raw database inspection and
        cleanup tools intended for development use only. These operate directly on tables and rows, bypassing the
        app&apos;s normal scheduling rules — they are not part of the shipped/live product and are expected to be
        removed or disabled before a real production launch.
      </p>
      <Note tone="warn" icon="!">
        These actions bypass business logic (for example, deleting a cell&apos;s row here doesn&apos;t check whether it
        has planned uses the way <b>Retire Cell</b> on the Cells tab does) — use with care, and only against
        development data.
      </Note>
      <dl className={styles.terms}>
        <dt>Export all tables</dt>
        <dd>
          Downloads every database table and all of its rows as a single timestamped JSON file — a quick backup or
          off-line snapshot of the whole database. It reads the tables exactly as shown here (no filtering) and changes
          nothing; disabled while the tables are still loading or when the database is empty.
        </dd>
        <dt>Clear backlog</dt>
        <dd>
          Permanently deletes every sample currently in the backlog (and its barcodes) in one step. Scheduled,
          in-progress, and completed samples are left untouched. Asks for confirmation and shows how many samples will
          be removed; disabled when the backlog is already empty. This can&apos;t be undone.
        </dd>
        <dt>Browsing tables</dt>
        <dd>
          The table list shows every database table with its row count. Selecting one shows its rows 50 at a time, with
          an <b>Edit</b> and a <b>Delete</b> button on each row.
        </dd>
        <dt>Edit (a single row)</dt>
        <dd>
          Opens a form with every column of that row (except its ID). Change any values and <b>Save changes</b> — only
          the fields you actually changed are written. Leaving a field empty sets it to null. Like the other developer
          tools, this writes straight to the row and skips the app&apos;s normal validation, so a value the app would
          otherwise reject can be saved; use it to correct data that was imported incorrectly, not as an everyday edit.
        </dd>
        <dt>Delete (a single row)</dt>
        <dd>Asks for confirmation, then permanently removes that one row. This can&apos;t be undone.</dd>
        <dt>Clear table</dt>
        <dd>
          Permanently deletes every row in the selected table — the table itself and its columns are kept, so it
          remains usable immediately afterward. Because this is irreversible, you must type the table&apos;s exact name
          into the confirmation dialog before the button enables; it&apos;s disabled when the table is already empty.
        </dd>
      </dl>
    </div>
  );
}

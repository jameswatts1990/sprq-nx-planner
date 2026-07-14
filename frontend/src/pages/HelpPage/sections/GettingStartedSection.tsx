import styles from "../HelpPage.module.css";

export function GettingStartedSection() {
  return (
    <div className={styles.copy}>
      <p>
        RevioNx Planner tracks SMRT cells and schedules them across your Revio/SPRQ-Nx instruments. A typical week
        flows through the tabs left to right:
      </p>
      <ol>
        <li>
          <b>Import</b> the samples and barcodes you want to sequence (paste or upload a CSV).
        </li>
        <li>
          They land in the <b>Backlog</b> — everything imported but not yet scheduled.
        </li>
        <li>
          On the <b>Schedule</b> you drag backlog samples onto instrument/day slots, or select empty days and let
          the planner auto-fill them.
        </li>
        <li>
          <b>Cells &amp; Instruments</b> shows every physical SMRT cell, how many of its uses are spent, and how
          much of its 108-hour lifetime window is left.
        </li>
        <li>
          <b>History</b> is the record of past and planned runs and of completed/failed samples.
        </li>
      </ol>
      <p>
        Nothing you do on the Schedule is final until you mark a run as loaded — until then, placements are
        &quot;planned&quot; and can be moved or cleared freely.
      </p>
      <p>
        The <b>Admin</b> tab has raw database tools for development use, and this <b>Help</b> tab documents every
        screen — see their sections below.
      </p>
    </div>
  );
}

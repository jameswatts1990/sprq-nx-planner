import styles from "../HelpPage.module.css";

export function TodaySection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> a one-page view of the day — what loads today, how the instruments stand, and
        what needs attention — so you can see at a glance where to start. It&apos;s the page RunNx opens on, and
        clicking the <b>RunNx</b> name at the top left always brings you back to it.
      </p>
      <p>
        Every card reads from the page it summarises and <b>refreshes itself every minute</b>, so a screen left open
        in the lab stays current (and turns over to the new day after midnight). Each card&apos;s link at its top
        right opens that page for the detail. A card with nothing to report says so in grey rather than disappearing.
      </p>
      <dl className={styles.terms}>
        <dt>Loading today</dt>
        <dd>
          The runs that load today, by instrument: the run (click it for its Run detail), how many wells it has, an{" "}
          <b>SPRQ</b> badge for single-use SPRQ cells, and its status. <b>Not loaded yet</b> means nobody has pressed{" "}
          <b>Confirm loaded</b>; once they have it reads <b>✓ Loaded</b> with the time. <b>Batch Sheet →</b> opens
          today&apos;s Batch Sheet for every instrument.
        </dd>
        <dt>Instruments</dt>
        <dd>
          Each active Revio with its status (<b>Ready</b>, <b>Running</b> or <b>Down</b>, as on the Instruments tab),
          what it&apos;s running and when it frees up (or <b>Idle</b>), and its next booked run after today. A Revio
          down today shows an amber <b>Down now</b> line with the period and reason; one with downtime coming up shows
          a blue <b>Downtime ahead</b> line instead.
        </dd>
        <dt>Trays expiring</dt>
        <dd>
          Trays whose 108-hour window closes in the next <b>18 hours</b> — the same warning the tray maps and the Cells
          tab use — soonest first, with the instrument, how many uses are still free to book and when the window
          closes. Use those uses (or accept losing them) before the time runs out. Click a tray to open it on the
          Cells tab.
        </dd>
        <dt>Backlog</dt>
        <dd>
          How many samples are waiting to be scheduled, and how many of them are <b>High priority</b> or{" "}
          <b>Aborted</b> (sent back when their cell was stopped). Click a High or Aborted number to open the Backlog
          already filtered to those samples.
        </dd>
        <dt>QC &amp; credits</dt>
        <dd>
          The same counts as the number on the QC &amp; credits tab: cases that <b>need a report</b> to PacBio,
          cases <b>overdue</b>, and cases <b>awaiting credit</b> from PacBio.
        </dd>
        <dt>QC Review</dt>
        <dd>
          How many SMRT cells the QC team failed in LangQC (a SMRT cell or instrument failure) are waiting in{" "}
          <b>QC Review</b> on the QC &amp; credits tab because RunNx hasn&apos;t failed them yet. Click the number to
          open it. <b>Oldest</b> is how many days ago QC signed off the longest-waiting one. It needs RunNx&apos;s MLWH
          connection: without one the card says so, and if MLWH can&apos;t be reached it shows the error.
        </dd>
        <dt>Day notes</dt>
        <dd>
          Today&apos;s notes from the Schedule, with the instruments each is pinned to and who wrote it.{" "}
          <b>Schedule →</b> opens this week, where you add or edit notes.
        </dd>
      </dl>
    </div>
  );
}

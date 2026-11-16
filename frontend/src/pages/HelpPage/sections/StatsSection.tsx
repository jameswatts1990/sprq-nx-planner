import styles from "../HelpPage.module.css";

export function StatsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What it&apos;s for:</b> a read-only report of charts and headline numbers built from everything else in
        the app — no data is entered here. Use it to see how much you&apos;re getting through, how well cells are
        being reused, where runs are failing, and what&apos;s outstanding — and to hand a monthly or quarterly
        summary to your manager.
      </p>

      <p className={styles.subheading}>Choosing the report</p>
      <p>
        Pick a <b>time range</b> — the last 30 or 90 days (up to today), this or last month, this or last quarter,
        this year, all time, or <b>Custom range…</b> with your own from and to dates — then how to <b>group</b> the
        trends (<b>by week</b>, <b>by month</b> or <b>by quarter</b>) and optionally a single <b>instrument</b>. The
        line under the pickers says exactly what the report covers. Your choices are kept in the page address, so
        you can bookmark a report or send someone the link and they&apos;ll see the same view.
      </p>
      <p>
        <b>Trends cover the selected range while the cell, sample and credit totals show the current state</b> — an
        outstanding credit or a stopped cell still matters even if it happened before the chosen window. Runs are
        placed in the range by their <b>load date</b>: a two-plate run counts once, in the period it was loaded, even
        when its Plate 2 acquires days later. Two things sit outside the range filter on purpose:{" "}
        <b>Samples imported</b> always counts every import, and <b>Samples by status</b> is always lab-wide (it
        ignores the instrument picker), while the cell and credit figures do narrow to the instrument you pick.
      </p>
      <p>
        <b>Export CSV</b> (top right) downloads the report&apos;s figures as a spreadsheet — one row per week, month
        or quarter, then a <b>Total</b> row, then (after a blank line) the instrument availability table — named after
        the range and grouping. <b>Print</b> lays the report out on
        A4 portrait, with the range at the top and each section kept on one page.
      </p>

      <p className={styles.subheading}>Headline numbers</p>
      <ul>
        <li>
          <b>Runs completed</b> — runs loaded in the range whose last cell has finished sequencing and analysis. You
          never mark a run completed yourself: once it&apos;s <b>Confirm loaded</b>, it counts here as soon as it has
          run its course (the same moment its tag turns <b>COMPLETED</b> on the schedule).
        </li>
        <li>
          <b>Samples sequenced</b> — the wells on those completed runs, less any marked <i>failed</i> or{" "}
          <i>aborted</i>.
        </li>
        <li>
          <b>Planned runs</b> — runs in the range still waiting for <b>Confirm loaded</b>. They aren&apos;t counted in
          any other figure.
        </li>
        <li>
          <b>Avg uses / cell</b> — average number of the 3 possible uses that finished cells actually reached. Higher
          is better value. Counts multi-use SPRQ-Nx cells only — a single-use SPRQ cell can never be reused, so
          it&apos;s left out of every reuse figure.
        </li>
        <li><b>Reaching Use 3</b> — the share of finished cells that got all 3 uses before their window closed.</li>
        <li>
          <b>Failure rate</b> — of all wells loaded (including runs still sequencing), the share marked{" "}
          <i>failed</i> (a data/cell problem, not an instrument abort). Planned runs don&apos;t count.
        </li>
        <li>
          <b>Plate fill</b> — how full the loaded plates were: wells used out of 4 per plate, so a one-plate run is
          measured against 4 wells and a two-plate run against 8.
        </li>
        <li>
          <b>Awaiting credit / Credits received</b> — PacBio credit cases reported but still waiting for the credit,
          and credits that have landed. Counts cases logged on the QC &amp; credits tab without a cell too.
        </li>
      </ul>

      <p className={styles.subheading}>Throughput &amp; run rate</p>
      <p>
        Samples sequenced and runs completed per week, month or quarter, how the completed runs split across your
        instruments, and the mix of movie lengths (12/24/30 h) across the wells loaded. This is the &quot;how busy
        have we been&quot; view.
      </p>

      <p className={styles.subheading}>Reuse &amp; utilisation</p>
      <p>
        The core value story. <b>Reuse depth</b> counts finished SPRQ-Nx cells by how far they got — Use 1 / 2 / 3, in
        the same magenta/blue/teal you see on the schedule (single-use SPRQ cells aren&apos;t counted).{" "}
        <b>Window outcome</b> compares cells that spent all 3 uses against those whose 108-hour window lapsed early
        (wasted capacity). <b>Avg uses per cell</b> and <b>Plate fill %</b> track those over time.
      </p>

      <p className={styles.subheading}>Failures &amp; credits</p>
      <p>
        <b>Run outcomes</b> splits the wells on loaded runs into completed / failed / aborted (a well on a run still
        sequencing has no outcome yet unless it was marked failed). <b>Failure rate %</b> tracks the failed share of
        wells loaded period by period. The <b>PacBio credit funnel</b> shows where every credit case is in the
        replacement process: needing a report → reported → awaiting credit → received. It covers failed/stopped cells
        and the cases logged on the QC &amp; credits tab without a cell; with an instrument picked, a case without a cell counts only
        if that instrument was entered on it.
      </p>

      <p className={styles.subheading}>Inventory &amp; backlog</p>
      <p>
        A snapshot of every cell by status, every sample by status (backlog through completed), and how many
        samples were imported each week, month or quarter.
      </p>

      <p className={styles.subheading}>Instrument availability</p>
      <p>
        One row per instrument: how many <b>weekdays</b> the range holds, how many of them fell in a{" "}
        <b>planned</b> or an <b>unplanned</b> downtime period (set on the Instruments tab), and the <b>uptime</b> —
        the share of weekdays it wasn&apos;t down. Only weekdays count, because runs only load Monday to Friday, and
        only days <b>up to today</b>: it&apos;s a look back, so downtime booked for later shows on the Instruments tab
        instead. With <b>All time</b> each instrument counts from its first run or downtime. Uptime shows — when the
        range has no weekday yet.
      </p>
    </div>
  );
}

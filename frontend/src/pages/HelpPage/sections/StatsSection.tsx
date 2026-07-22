import styles from "../HelpPage.module.css";

export function StatsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What it&apos;s for:</b> a read-only dashboard of charts and headline numbers built from everything else
        in the app — no data is entered here. Use it to see how much you&apos;re getting through, how well cells are
        being reused, where runs are failing, and what&apos;s outstanding.
      </p>

      <p className={styles.subheading}>Filters at the top</p>
      <p>
        Pick a <b>time range</b> (30 days, 90 days, or all time) and optionally a single <b>instrument</b>. The
        trend charts (anything &quot;per week&quot;) follow these filters. The current-state figures — cells by
        status, samples by status, and the PacBio credit funnel — always show the situation <i>right now</i>,
        because an outstanding credit or a stopped cell still matters even if it happened before the chosen window.
      </p>

      <p className={styles.subheading}>Headline numbers</p>
      <ul>
        <li><b>Runs completed / Samples completed</b> — finished runs and finished cell-uses in the range.</li>
        <li><b>Avg uses / cell</b> — average number of the 3 possible uses that finished cells actually reached. Higher is better value.</li>
        <li><b>Reaching Use 3</b> — the share of finished cells that got all 3 uses before their window closed.</li>
        <li><b>Failure rate</b> — of the runs that got a verdict, the share marked <i>failed</i> (a data/cell problem, not an instrument abort).</li>
        <li><b>Well fill</b> — how full runs were, out of the 8 wells a run can hold.</li>
        <li><b>Awaiting credit / Credits received</b> — cells reported to PacBio still waiting for a replacement credit, and credits that have landed.</li>
      </ul>

      <p className={styles.subheading}>Throughput &amp; run rate</p>
      <p>
        Samples and runs per week, how the runs split across your instruments, and the mix of movie lengths
        (12/24/30 h). This is the &quot;how busy have we been&quot; view.
      </p>

      <p className={styles.subheading}>Reuse &amp; utilisation</p>
      <p>
        The core value story. <b>Reuse depth</b> counts finished cells by how far they got — Use 1 / 2 / 3, in the
        same magenta/blue/teal you see on the schedule. <b>Window outcome</b> compares cells that spent all 3 uses
        against those whose 108-hour window lapsed early (wasted capacity). <b>Avg uses per cell</b> and{" "}
        <b>well fill %</b> track those over time.
      </p>

      <p className={styles.subheading}>Failures &amp; credits</p>
      <p>
        <b>Run outcomes</b> breaks cell-uses into completed / failed / aborted. <b>Failure rate %</b> tracks the
        failed share week by week. The <b>PacBio credit funnel</b> shows where failed/stopped cells are in the
        replacement process: needing a report → reported → awaiting credit → received.
      </p>

      <p className={styles.subheading}>Inventory &amp; backlog</p>
      <p>
        A snapshot of every cell by status, every sample by status (backlog through completed), and how many
        samples were imported each week.
      </p>
    </div>
  );
}

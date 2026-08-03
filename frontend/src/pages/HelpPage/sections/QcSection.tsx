import styles from "../HelpPage.module.css";

export function QcSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> the single home for every cell in the <b>PacBio credit workflow</b> — the cells
        that have <b>failed</b> or been <b>stopped</b> and are now chasing a credit back from PacBio. Instead of opening
        cells one at a time, it lists every open case together, shows how far each has got, and lets you take the next
        step right from the list.
      </p>
      <p>
        A cell lands here the moment it gets a <b>Failed</b> run or is <b>Stopped</b> in <b>Cell QC</b> (see the Cells
        section) — exactly the cells that grow a <b>PacBio credit</b> card on their own detail page. A cell that was{" "}
        <i>Retired</i> without a failed run never enters the credit workflow, so it doesn&apos;t appear here.
      </p>

      <p className={styles.subheading}>The numbers at the top</p>
      <p>A row of headline counts summarises the whole workflow at a glance:</p>
      <ul>
        <li>
          <b>Open cases</b> — cells still working toward a credit (everything except those already received).
        </li>
        <li>
          <b>Needs report</b> — a credit case that hasn&apos;t been raised with PacBio yet.
        </li>
        <li>
          <b>Awaiting credit</b> — reported to PacBio, credit not yet confirmed or received.
        </li>
        <li>
          <b>Confirmed</b> — PacBio has confirmed a credit; it just hasn&apos;t physically landed yet.
        </li>
        <li>
          <b>Credit received</b> — settled cases (also the count in the collapsed group below).
        </li>
        <li>
          <b>Samples affected</b> — how many distinct samples sit on a failed run across the open cases.
        </li>
      </ul>

      <p className={styles.subheading}>The worklist</p>
      <p>
        Below the numbers, cases are grouped by the stage they&apos;re at, in the order you work them:{" "}
        <b>Needs report → Awaiting PacBio credit → Confirmed — awaiting receipt</b>. Within each group the{" "}
        <b>oldest case sits first</b>, so the one most in need of chasing is at the top. Settled cases collapse into a{" "}
        <b>Received / settled</b> group at the very bottom — click its heading to expand it when you want to review
        recent history. Empty groups are hidden, and if nothing is in the workflow the page simply says so.
      </p>

      <p className={styles.subheading}>A case row</p>
      <p>Each row is one cell&apos;s credit case. On it you&apos;ll see:</p>
      <ul>
        <li>
          The <b>cell code</b> (links to the cell), its <b>status badge</b>, the <b>instrument · well</b> and{" "}
          <b>tray</b> it&apos;s on, and the <b>failure date</b> on the right.
        </li>
        <li>
          The <b>failed run</b> and the <b>sample</b> that was on it (both link through), plus the stop reason if one
          was given.
        </li>
        <li>
          A <b>five-dot stage strip</b> — the same five stages as the cell&apos;s PacBio credit card (Failure → PacBio
          report → Internal report → Credit confirmed → Credit received): green dots are done, the highlighted dot is
          where the case is now.
        </li>
        <li>
          The <b>next action, inline</b>: paste the PacBio <b>case number</b>, add the <b>internal report ID</b>,
          record the <b>acquisitions credited</b>, or <b>Mark as received in lab</b> — whichever the case needs next,
          done without leaving the page. The list updates itself and the case moves to the next group.
        </li>
      </ul>
      <p>
        Click the <b>▸</b> on the left of a row to expand the full <b>PacBio credit tracker</b> for that cell — the same
        card you see on the cell&apos;s detail page, including <b>Generate email…</b> (drafts the email to PacBio) and{" "}
        <b>Generate report ▾</b> (copies or downloads the issue-tracking row). Acting here or on the cell&apos;s own page
        is exactly the same; the QC tab just gathers every case in one worklist. The step-by-step meaning of each stage
        is described under <b>PacBio credit</b> in the Cells section.
      </p>
    </div>
  );
}

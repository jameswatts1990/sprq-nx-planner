import { Badge } from "@/components/ui/Badge";
import { NO_CELL_BADGE } from "@/utils/creditCase";

import styles from "../HelpPage.module.css";

export function QcSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> the one home for every <b>PacBio credit case</b> — the cells that have{" "}
        <b>failed</b> or been <b>stopped</b> and are now chasing a credit back from PacBio, plus any case you log by
        hand that isn&apos;t linked to a cell. Instead of opening cells one at a time, it lists every open case together,
        shows how far each has got, and lets you take the next step right from the list.
      </p>
      <p>
        A cell lands here the moment it gets a <b>Failed</b> run or is <b>Stopped</b> in <b>Cell QC</b> (see the Cells
        section) — exactly the cells that grow a <b>PacBio credit</b> card on their own detail page. A cell that was{" "}
        <i>Retired</i> without a failed run never enters the credit workflow, so it doesn&apos;t appear here. Anything
        else PacBio should credit is added with <b>+ Add case without a cell</b> (see below).
      </p>

      <p className={styles.subheading}>The numbers at the top</p>
      <p>A row of headline counts summarises the whole workflow at a glance, cases with and without a cell alike:</p>
      <ul>
        <li>
          <b>Open cases</b> — cases still working toward a credit (everything except those already received).
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
          <b>Acquisitions credited</b> — the total acquisitions PacBio has confirmed they&apos;ll credit, added up
          across every confirmed and received case.
        </li>
        <li>
          <b>Samples affected</b> — how many distinct samples sit on a failed run across the open cell cases.
        </li>
      </ul>

      <p className={styles.subheading}>The worklist</p>
      <p>
        Below the numbers, cases are grouped by the stage they&apos;re at, in the order you work them:{" "}
        <b>Needs report → Awaiting PacBio credit → Confirmed — awaiting receipt</b>. Within each group the{" "}
        <b>oldest case sits first</b>, so the one most in need of chasing is at the top. Settled cases collapse into a{" "}
        <b>Received / settled</b> group at the very bottom — click its heading to expand it when you want to review
        recent history. Empty groups are hidden, and if there are no cases at all the page simply says so.
      </p>

      <p className={styles.subheading}>A case row</p>
      <p>Each row is one credit case. For a cell&apos;s case you&apos;ll see:</p>
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
        Click the <b>▸</b> on the left of a row to expand the full <b>PacBio credit tracker</b> for that case — the same
        card you see on a cell&apos;s detail page, including <b>Generate email…</b> (drafts the email to PacBio) and{" "}
        <b>Generate report ▾</b> (copies or downloads the issue-tracking row). Acting here or on the cell&apos;s own page
        is exactly the same; the QC tab just gathers every case in one worklist. The step-by-step meaning of each stage
        is described under <b>PacBio credit</b> in the Cells section.
      </p>

      <p className={styles.subheading}>Cases without a cell</p>
      <p>
        Some credits don&apos;t belong to a cell RunNx tracks — a cell that failed on a run the app didn&apos;t schedule,
        a damaged tray, a faulty kit. Log these with <b>+ Add case without a cell</b> at the top of the page. The form
        opens with a warning, because a case like this is <b>not linked to any cell</b>: it never changes a cell, a
        sample or the schedule, and the app can&apos;t work out the expected reimbursement for you. If the failure was
        on a cell RunNx does track, cancel and use <b>Cell QC</b> on that cell instead — its case then appears here on
        its own.
      </p>
      <ul>
        <li>
          <b>What happened</b> and the <b>date</b> are required. The <b>instrument</b>, <b>run</b>,{" "}
          <b>sample / Pool ID</b> and <b>acquisitions to claim</b> are optional — they fill in{" "}
          <b>Generate email…</b> and <b>Generate report</b>, and the acquisitions show as the case&apos;s{" "}
          <b>Expected reimbursement</b>.
        </li>
        <li>
          Already raised it with PacBio? Enter the <b>PacBio case number</b> on the form and the case starts at{" "}
          <b>Awaiting PacBio credit</b> instead of <b>Needs report</b>. You can also add a case note.
        </li>
        <li>
          From then on it works exactly like a cell&apos;s case: the same groups, the same stage strip and the same
          inline actions — including recording the <b>acquisitions credited</b> when PacBio confirm.
        </li>
        <li>
          On the list it shows its summary where a cell code would be, flagged{" "}
          <Badge tone={NO_CELL_BADGE.tone}>{NO_CELL_BADGE.label}</Badge>. Expand it to see everything you entered,
          with <b>Edit details</b> to correct a mistake and <b>Delete case</b> to remove one logged in error (it
          asks first, and can&apos;t be undone from the app).
        </li>
      </ul>
    </div>
  );
}

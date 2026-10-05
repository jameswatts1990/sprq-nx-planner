import { Badge } from "@/components/ui/Badge";
import { CREDIT_OVERDUE_DAYS, NO_CELL_BADGE, OVERDUE_BADGE } from "@/utils/creditCase";

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

      <p className={styles.subheading}>The overview line</p>
      <p>
        One slim line under the title totals every case, with and without a cell — it always covers everything, even
        while you&apos;re searching. Click the <b>title</b> (or its <b>▸</b>) to hide or show it; your browser remembers
        the choice.
      </p>
      <ul>
        <li>
          <b>Open</b> — cases not yet received. <b>Overdue</b> — open cases stuck at one stage for more than{" "}
          {CREDIT_OVERDUE_DAYS} days (shown in red when there are any).
        </li>
        <li>
          <b>Needs report / Awaiting PacBio / Confirmed / Received</b> — how many cases are at each stage.
        </li>
        <li>
          <b>Acq pending</b> — the acquisitions still expected back on open cases PacBio haven&apos;t confirmed yet.
        </li>
        <li>
          <b>Acq credited</b> — the acquisitions PacBio have confirmed, across confirmed and received cases, also shown
          in <b>trays</b>. PacBio credit acquisitions translated to cells — <b>1 cell = 3 acquisitions = 0.25 tray</b> —
          and their FOC tracker counts trays, so the tray figure is the one to tally against it.
        </li>
      </ul>

      <p className={styles.subheading}>Search and export</p>
      <p>
        The <b>search box</b> filters every group as you type — by PacBio case number, internal report ID, owner, cell
        code or case summary, run, sample or instrument. A case number matches with or without PacBio&apos;s leading
        zeros (00316913 or 316913), and the <b>Received / settled</b> group opens by itself when a match is in there.{" "}
        <b>Export CSV</b> downloads the cases shown (all of them when you&apos;re not searching) as a spreadsheet: case
        number, owner, stage, dates, acquisitions expected and credited — credited also as cells and trays — plus the
        instrument, run and sample.
      </p>

      <p className={styles.subheading}>The worklist</p>
      <p>
        Cases are grouped by the stage they&apos;re at, in the order you work them:{" "}
        <b>Needs report → Awaiting PacBio credit → Confirmed — awaiting receipt</b>. Within each group the{" "}
        <b>oldest case sits first</b>, so the one most in need of chasing is at the top. Settled cases collapse into a{" "}
        <b>Received / settled</b> group at the very bottom — click its heading to expand it when you want to review
        recent history. Empty groups are hidden, and if there are no cases at all the page simply says so.
      </p>

      <p className={styles.subheading}>A case row</p>
      <p>Each row is one credit case. For a cell&apos;s case you&apos;ll see:</p>
      <ul>
        <li>
          The <b>cell code</b> (links to the cell), its <b>status badge</b>, and the <b>instrument · well</b> and{" "}
          <b>tray</b> it&apos;s on.
        </li>
        <li>
          On the right, the case at a glance: its <b>PacBio case number</b>, the <b>acquisitions</b> (expected until
          PacBio confirm, then credited), the <b>owner</b>, how many <b>days it&apos;s been open</b>, and the failure
          date. Anything not recorded yet reads in grey (<i>No case #</i>, <i>No owner</i>). A case that&apos;s made no
          progress for more than {CREDIT_OVERDUE_DAYS} days shows{" "}
          <Badge tone={OVERDUE_BADGE.tone}>{OVERDUE_BADGE.label} · 45 d</Badge> instead — hover it to see what it&apos;s
          waiting on.
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
          record the <b>acquisitions credited</b> (pre-filled with the expected figure — change it if PacBio credited a
          different number), or <b>Mark as received in lab</b> — done without leaving the page. The list updates itself
          and the case moves to the next group.
        </li>
      </ul>
      <p>
        Click the <b>▸</b> on the left of a row to expand the full <b>PacBio credit tracker</b> for that case — the same
        card you see on a cell&apos;s detail page, including <b>Generate email…</b> (drafts the email to PacBio) and{" "}
        <b>Generate report ▾</b> (copies or downloads the issue-tracking row). Under the next step, a{" "}
        <b>Recorded</b> line shows the <b>Owner</b> and every value already saved — case number, report ID,
        acquisitions credited — each with a <b>✎</b> to correct a typo or a recount in place. Correcting a value
        doesn&apos;t change when that step happened. The step-by-step meaning of each stage is described under{" "}
        <b>PacBio credit</b> in the Cells section.
      </p>

      <p className={styles.subheading}>Case owner</p>
      <p>
        Each case can have an <b>owner</b> — whoever is chasing it, as a Sanger ID or a name. Set it with the{" "}
        <b>✎</b> next to <b>Owner</b> in the expanded tracker (or on the form when you add a case without a cell). It
        shows on the row, and fills the <b>Reported by (Sanger ID)</b> column of the generated issue report. Your
        browser remembers the last owner you saved and offers it next time, but it&apos;s never filled in on a case
        until you save it.
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
          <b>Expected reimbursement</b>. Add the <b>owner</b> here too.
        </li>
        <li>
          <b>Already progressed?</b> Logging an older case, fill in any step you&apos;ve already done — the{" "}
          <b>PacBio case number</b>, the <b>internal report ID</b>, the <b>acquisitions credited</b>, and tick{" "}
          <b>Credit already received in lab</b> — and the case starts at that stage, with nothing to click through
          afterwards. A credit can only be confirmed or received for a case raised with PacBio, so those need the case
          number; the form tells you if it&apos;s missing.
        </li>
        <li>
          From then on it works exactly like a cell&apos;s case: the same groups, the same stage strip and the same
          inline actions.
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

import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { EXAMPLE_QC_SUMMARY, QcNavCountBadge } from "@/components/layout/QcNavCount";
import { Badge } from "@/components/ui/Badge";
import { useOverdueDays } from "@/hooks/useOverdueDays";
import { NO_CELL_BADGE, OVERDUE_BADGE, QC_REVIEW_BADGE } from "@/utils/creditCase";

import styles from "../HelpPage.module.css";

export function QcSection() {
  const overdueDays = useOverdueDays() ?? "…";
  return (
    <div className={styles.copy}>
      <p>
        <b>What the QC &amp; credits tab is for:</b> the one home for every <b>PacBio credit case</b> — the cells that have{" "}
        <b>failed</b> or been <b>stopped</b> and are now chasing a credit back from PacBio, plus any case you log by
        hand that isn&apos;t linked to a cell. Instead of opening cells one at a time, it lists every open case together,
        shows how far each has got, and lets you take the next step right from the list.
      </p>
      <p>
        A cell lands here the moment it gets a <b>Failed</b> run or is <b>Stopped</b> in <b>Cell QC</b> (see the Cells
        section) — exactly the cells that grow a <b>PacBio credit</b> card on their own detail page. A cell that was{" "}
        <i>Retired</i> without a failed run never enters the credit workflow, so it doesn&apos;t appear here. Anything
        else PacBio should credit is added with <b>+ Add case without a cell</b> (see below). And at the top of the
        page, <b>QC Review</b> brings in the cells the QC team failed after the run, which RunNx would otherwise never
        hear about.
      </p>

      <p className={styles.subheading}>QC Review: failures the QC team found</p>
      <p>
        After a run, the QC team give every SMRT cell a verdict in LangQC, and it&apos;s stored in MLWH (the
        sequencing warehouse). A <b>Failed, SMRT cell</b> or <b>Failed, Instrument</b> verdict means the cell or the
        instrument let the run down, which makes it a PacBio credit case. It happens outside RunNx, though, so unless
        someone also failed the cell here, RunNx wouldn&apos;t know. The <b>QC Review</b> list at the top of the page
        shows every such cell from the last <b>90 days</b> (change this in <b>Settings › QC &amp; credits</b>) that
        RunNx hasn&apos;t failed. Each one is labelled <Badge tone={QC_REVIEW_BADGE.tone}>{QC_REVIEW_BADGE.label}</Badge>.
        A plain <i>Failed</i> verdict means the sample missed its targets, which isn&apos;t a credit case, so it never
        appears here.
      </p>
      <ul>
        <li>
          Each row names the <b>Traction run</b>, <b>plate and well</b>, the QC verdict, the instrument and the date QC
          signed it off. The oldest sign-off is at the top. Under it is the RunNx cell the well was loaded as: its <b>cell code</b>, which <b>use</b> it
          was, and the <b>sample</b>, each linking through. RunNx finds that cell by the run&apos;s Traction name, so
          enter it at <b>Confirm loaded</b>. A run with no Traction name is matched by instrument and load day
          instead, and flagged <Badge tone="warning">Matched by instrument &amp; date</Badge> so you check it.{" "}
          <Badge tone="warning">Pool ID differs</Badge> means RunNx&apos;s sample in that well isn&apos;t the library
          MLWH says was loaded. <Badge tone="orange">Not in RunNx</Badge> means RunNx has no record of the run.
        </li>
        <li>
          <b>Confirm fail…</b> opens the usual <b>Cell QC</b> on that run, with the QC verdict already filled in as the
          reason. Choose <b>Fail cell</b> or <b>Fail and stop cell</b> and decide what happens to the sample, exactly
          as if you&apos;d started it here. The cell&apos;s credit case then joins the list below, labelled{" "}
          <Badge tone={QC_REVIEW_BADGE.tone}>{QC_REVIEW_BADGE.label}</Badge>. <b>Undo QC</b> on the cell takes the fail
          back and returns the well to QC Review.
        </li>
        <li>
          When RunNx has no cell to fail (the run isn&apos;t in RunNx, nothing was in that well, or RunNx recorded the
          run as completed or aborted), the button is <b>Log case…</b> instead. It opens <b>Add case without a cell</b>{" "}
          filled in from MLWH, and the case is labelled <Badge tone={QC_REVIEW_BADGE.tone}>{QC_REVIEW_BADGE.label}</Badge>{" "}
          too. If RunNx has the cell but can&apos;t fail it yet (its run isn&apos;t confirmed loaded, say),{" "}
          <b>Confirm fail…</b> is greyed out and the row says why. Sort that out first, then confirm the fail.
        </li>
        <li>
          <b>Ignore…</b> is for a well that shouldn&apos;t become a credit case, such as one PacBio declined or a run
          from before RunNx. Give a reason, and the well moves to a collapsed <b>Ignored</b> list under QC Review with
          that reason. <b>Restore</b> puts it back.
        </li>
        <li>
          A well leaves the list as soon as RunNx has a fail on it, whichever way it was recorded. It comes back if that
          fail is undone or the case is deleted. Click the <b>▸</b> on a row for the MLWH details: the SMRT cell barcode
          and lot, which use of the cell it was, the movie, the loading, the HiFi yield and the library tubes, plus a link
          to the run in SMRT Link.
        </li>
        <li>
          QC Review needs RunNx&apos;s MLWH connection. Without one, the list says it isn&apos;t available. If MLWH
          can&apos;t be reached, it shows the error with a <b>Retry</b>. The rest of the page works either way.
        </li>
      </ul>

      <p className={styles.subheading}>The count on the QC &amp; credits tab</p>
      <p>
        The <b>QC &amp; credits</b> tab in the top bar carries a red count{" "}
        <QcNavCountBadge summary={EXAMPLE_QC_SUMMARY} /> of the cases that need you: not yet reported to PacBio, or overdue. A case that&apos;s both counts once. Cases
        waiting on PacBio within the limit don&apos;t count. Hover it for the breakdown. It refreshes every minute and
        straight after any change to a case, and disappears when nothing needs doing.
      </p>

      <p className={styles.subheading}>The overview</p>
      <p>
        A row of total tiles under the page title counts every case, with and without a cell — it always covers everything,
        even while you&apos;re searching. Click <b>Hide overview</b> / <b>Show overview</b> (top right, beside the
        search box) to hide or show it; your browser remembers the choice. Hover a tile to see what it counts.
      </p>
      <ul>
        <li>
          <b>QC Review</b> — the wells waiting in the QC Review list (a dash when MLWH isn&apos;t available).{" "}
          <b>Open</b> — cases not yet received. <b>Overdue</b> — open cases stuck at one stage for more than{" "}
          {overdueDays} days (shown in red when there are any). The limit is set in <b>Settings › QC &amp; credits</b>.
        </li>
        <li>
          <b>Needs report / Awaiting PacBio / Confirmed / Received</b> — how many cases are at each stage.
        </li>
        <li>
          <b>Acq pending</b> — the acquisitions still expected back on open cases PacBio haven&apos;t confirmed yet.
        </li>
        <li>
          <b>Acq credited</b> — the acquisitions PacBio have confirmed, across confirmed and received cases, also shown
          in <b>trays</b> (the line under the number). PacBio credit acquisitions translated to cells, and how many make a cell depends on the cell
          type: a multi-use <b>SPRQ-Nx</b> cell is <b>3 acquisitions</b>, a single-use <b>SPRQ</b> cell is{" "}
          <b>1 acquisition</b> — so one SPRQ credit is a whole cell. Either way <b>4 cells = 1 tray</b>. Their FOC
          tracker counts trays, so the tray figure is the one to tally against it; once any SPRQ credit exists the
          trays are shown per type (<i>SPRQ-Nx + SPRQ</i>), since they&apos;re different products. Each case carries an
          indigo <CellTypeBadge cellType="sprq" /> badge when it&apos;s about a SPRQ cell, and the CSV export has a{" "}
          <b>Cell type</b> column with the cells and trays worked out the same way.
        </li>
      </ul>

      <p className={styles.subheading}>Search and export</p>
      <p>
        The <b>search box</b> filters every group as you type — by PacBio case number, internal report ID, owner, cell
        code or case summary, run, sample or instrument. It filters QC Review too, by run, well, SMRT cell barcode or
        library tube. A case number matches with or without PacBio&apos;s leading
        zeros (00316913 or 316913), and the <b>Received / settled</b> group opens by itself when a match is in there.{" "}
        <b>Export CSV</b> downloads the cases shown (all of them when you&apos;re not searching) as a spreadsheet: case
        number, owner, stage, dates, acquisitions expected and credited — credited also as cells and trays — plus the
        instrument, run and sample. Its <b>Source</b> column says whether a case came from <i>QC Review</i> or was
        started in <i>RunNx</i>.
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
          <b>tray</b> it&apos;s on. A case that came in through QC Review also carries{" "}
          <Badge tone={QC_REVIEW_BADGE.tone}>{QC_REVIEW_BADGE.label}</Badge>.
        </li>
        <li>
          On the right, the case at a glance: its <b>PacBio case number</b>, the <b>acquisitions</b> (expected until
          PacBio confirm, then credited), the <b>owner</b>, how many <b>days it&apos;s been open</b>, and the failure
          date (with its time, when the run recorded one). Anything not recorded yet reads in grey (<i>No case #</i>,{" "}
          <i>No owner</i>). A case that&apos;s made no progress for more than {overdueDays} days shows{" "}
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
          The <b>next action, inline</b>: paste the PacBio <b>case number</b> (an amber note warns if another case
          already has it — a likely copy-paste slip — but you can still save), add the <b>internal report ID</b>,
          record the <b>acquisitions credited</b> (pre-filled with the expected figure — change it if PacBio credited a
          different number), or <b>Mark as received in lab</b> — done without leaving the page. The list updates itself
          and the case moves to the next group.
        </li>
      </ul>
      <p>
        Click the <b>▸</b> on the left of a row to expand the full <b>PacBio credit tracker</b> for that case — the same
        card you see on a cell&apos;s detail page, including <b>Generate email…</b> (drafts the email to PacBio) and{" "}
        <b>Generate report ▾</b> (copies or downloads the issue-tracking row). The report&apos;s team, equipment owner
        and manager columns come from <b>Settings › Issue report</b>; any not set there are left blank, and the
        report preview says which. Under the next step, a{" "}
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
        name from the top bar is offered as the owner (and pre-filled on the add-a-case form), but it&apos;s never
        set on a case until you save it.
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
          <b>Expected reimbursement</b>. Add the <b>owner</b> here too. Set the <b>cell type</b> (SPRQ-Nx, the
          default, or single-use SPRQ) so the credit counts as the right number of cells — a SPRQ cell is 1
          acquisition, a SPRQ-Nx cell 3.
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

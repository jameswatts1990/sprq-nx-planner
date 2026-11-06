import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { TrayCellStrip } from "@/components/cells/TrayCellStrip";

import styles from "../HelpPage.module.css";
import { EXAMPLE_TRAY_STRIP } from "./helpFixtures";

export function CellsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this page is for</b> (<b>History → Cells</b>): browsing every physical SMRT cell tray the system knows
        about — one row per tray, with each of its cells&apos; state at a glance — and drilling into any cell, sample or
        run it touched.
      </p>

      <p className={styles.subheading}>The tray list</p>
      <p>
        Each row is one physical tray: its <b>Tray</b> id (click it to open that tray on its own page), its{" "}
        <b>Chemistry</b> (SPRQ-Nx, or single-use <CellTypeBadge cellType="sprq" />), the <b>Instrument</b> it&apos;s on,
        a chip for each of its <b>Cells</b>, its <b>Uses left</b> — uses on its open cells that are still free to book,
        out of the tray&apos;s total —
        its <b>First use</b>, its <b>Last run</b> date, when it <b>Expires</b>, and any <b>Flags</b>. A cell
        registered with <b>Register in-progress cell</b> has no tray, so it gets a row of its own marked{" "}
        <b>No tray</b>.
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <TrayCellStrip cells={EXAMPLE_TRAY_STRIP} />
          <span>
            <b>The cell chips.</b> One chip per tray position (1–4), coloured like the cell&apos;s status badge — here
            cell 1 is open, cell 2 was stopped by Cell QC, cell 3 is exhausted and cell 4 is unused with its first use
            booked. Each pip is one use: filled in its use-status colour once spent (completed, running, aborted,
            failed…), grey while booked for later, an open ring while still free to book, and a dash for capacity the
            cell will never use (stopped, retired, discarded or window closed). Hover a chip for the cell&apos;s full
            story; click it to open the cell.
          </span>
        </div>
      </div>
      <p>
        <b>Expires</b> is when the tray&apos;s soonest 108-hour window closes — the latest its next reuse can start —
        with the hours left underneath, in amber once 18 hours or fewer remain. It reads <b>Not started</b> until the
        tray&apos;s first cell is used, <b>Window closed</b> once a window has run out, and — for single-use SPRQ trays,
        which are never reused — a dash. <b>Flags</b> call out anything that needs a second look:{" "}
        <b>Unreported</b> / <b>Awaiting credit</b> (a cell has an open PacBio credit case — see below),{" "}
        <b>Reuse skipped</b> (a planned disposal) and <b>Discarded</b> (thrown away before all its uses were spent —
        not shown when Auto Schedule disposes a tray whose uses are all spent or booked).
      </p>
      <p>
        <b>Click a row</b> (or its <b>▸</b>) to expand it. The expanded tray lists each cell with its status, uses
        spent, hours left on its own window, every <b>sample &amp; run</b> it carried — tagged <b>[1]</b>/<b>[2]</b>/
        <b>[3]</b> for which use, with the use&apos;s status and links to the sample and the run — and its burned
        barcodes. Underneath are the tray-wide actions (below). Several rows can be open at once.
      </p>

      <p className={styles.subheading}>Search, filters &amp; sorting</p>
      <p>
        The <b>Search</b> box matches <i>any</i> id associated with a cell — its own code, its tray (type <b>T123</b>{" "}
        or just <b>123</b>), a Pool ID, Sanger ID or Plate ID, a barcode, a run name or run number (<b>#45</b>), or the
        instrument it ran on — and lists the trays holding those cells. The matching cell is ringed in its tray&apos;s
        chips and highlighted when the row is expanded; a search with a single hit opens that tray straight away.
      </p>
      <p>
        The <b>status</b> dropdown shows trays with at least one cell in that state — <b>Open</b> (the default),
        Exhausted, Window expired, Retired or Stopped, or <b>Any status</b> — always with <i>all</i> of each
        tray&apos;s cells, so you see the whole tray. Its <b>PacBio credit</b> options, <b>QC: Unreported</b> and{" "}
        <b>QC: Awaiting credit</b>, cut across status to find trays with a cell at that stage of the credit workflow.
        The <b>chemistry</b> and <b>instrument</b> dropdowns narrow it further.
      </p>
      <p>
        <b>Click a column heading</b> (Tray, Instrument, Uses left, First use, Last run, Expires) to sort by it; click
        it again to flip the direction (▲/▼). The list opens sorted by <b>Expires</b>, soonest first, so the trays to
        reuse before they run out are on top; trays with nothing to sort on (e.g. no window yet) always sit at the
        bottom. <b>Rows</b> sets how many trays a page shows, with <b>Previous</b> / <b>Next</b> under the list. Your
        search, filters, sort and page are kept in the page address, so <b>Back</b> from a cell, sample or tray returns
        you to exactly this list — and you can bookmark or share a filtered view.
      </p>

      <p className={styles.subheading}>Now vs End of week</p>
      <p>
        The <b>Showing data as of</b> switch above the list flips every time-based figure on the page between{" "}
        <b>Now</b> and <b>End of week</b> (this week&apos;s Friday). A cell whose next uses are still <i>scheduled</i>{" "}
        for later this week shows them as booked (grey pips) under <b>Now</b>, but spent under <b>End of week</b> — so
        a cell can read 1 / 3 and open now, yet 3 / 3 and exhausted by Friday. Windows and the status filter shift the
        same way, letting you see which trays will be spent or expired by the end of the week. <b>Uses left</b> only
        ever counts uses still free to book, so a booked use never reads as free in either view. It&apos;s a view only
        — nothing changes on the cells; the Schedule grid is where placements happen.
      </p>

      <p className={styles.subheading}>Trays</p>
      <p>
        A physical SMRT Cell tray holds 4 cells — multi-use <b>SPRQ-Nx</b> (up to 3 uses each), or single-use{" "}
        <b>SPRQ</b>, whose cells and tray carry an indigo <CellTypeBadge cellType="sprq" /> badge and run once each (the
        type is set per run on the Schedule&apos;s load-time dial). Clicking a <b>tray id</b> anywhere in the app (a
        tray row, a cell&apos;s detail page, a seal popover, the QC worklist, or the Schedule grid&apos;s instrument
        cell map) opens that tray on its own page — the same row, already expanded. Its <b>◂</b> link returns to where
        you came from. (This physical &quot;tray&quot; is a different thing from the Schedule grid&apos;s &quot;Plate
        1&quot;/&quot;Plate 2&quot; loading positions within a run - see the Schedule section.)
      </p>
      <p>
        <b>Tray actions</b> sit under an expanded tray:
      </p>
      <ul>
        <li>
          <b>Skip reuse</b> — if you already know you&apos;ll bin a part-used tray but haven&apos;t physically pulled it
          yet, this flags it so Auto Schedule stops reusing it and opens fresh cells instead (the same switch as the
          Schedule&apos;s <b>Autoschedule</b> panel&apos;s <b>Reuse this week</b> list). The row then shows a{" "}
          <b>Reuse skipped</b> flag. It&apos;s a reversible <i>plan</i> only — no cell status changes and nothing is
          thrown away; <b>Allow reuse again</b> clears it.
        </li>
        <li>
          <b>Discard all cells</b> — force-closes every cell still physically in the tray, cancelling any not-yet-run
          placements for those cells (their samples return to the backlog) and marking every cell exhausted
          regardless of how many uses it has left. Offered while at least one cell in the tray is still open. Use it
          when a tray is being pulled from the instrument for good and its remaining capacity won&apos;t be used.
        </li>
        <li>
          <b>Restore tray</b> — offered when a discard threw away unused uses, it brings the tray back into service. The cancelled placements stay in the backlog
          to re-place; a tray swapped out with the grid&apos;s <b>⏏</b> button gets its later uses moved back unless
          they&apos;ve since been <b>Confirm loaded</b>.
        </li>
      </ul>
      <p>
        <b>Auto Schedule disposes whole trays too:</b> a tray of 4 is one physical object — it&apos;s thrown away as
        a unit, never one cell at a time. So when you auto-schedule, a tray is disposed automatically only once{" "}
        <b>every</b> cell in it has been used to your <b>Max uses per cell</b> setting; all 4 cells then show as{" "}
        <b>Exhausted</b> together, exactly like a manual discard, and are never offered for reuse again. A tray still
        holding an unused or below-target cell is left alone (every cell stays open) until a later run finishes it.
        Disposed cells keep their already-scheduled runs; only the spare capacity is closed off.
      </p>
      <p>
        <b>You can only dispose a whole tray, never a single cell.</b> All four cells share one physical box that goes
        in and out of the instrument as a unit, so there is no &quot;discard one cell&quot; action. The <i>only</i> way
        a single cell leaves service on its own — while its tray-mates stay usable — is a <b>QC Stop</b> (a
        hardware-fault action; see <b>Cell QC</b> below), and even then the cell is marked Stopped, not thrown away.
      </p>

      <p className={styles.subheading}>The 108-hour window</p>
      <p>
        A multi-use cell has <b>108 hours</b> from its first use to the start of its last reuse. Each cell&apos;s
        window is its own, so a tray&apos;s <b>Expires</b> follows whichever open cell runs out first; the expanded row
        shows every cell&apos;s hours left (hover for hours used). Exhausted, retired and stopped cells no longer count
        down, and a single-use <b>SPRQ</b> cell has no window at all since it&apos;s never reused.
      </p>
      <p>
        <b>Register in-progress cell</b> (button, top right) is a one-off setup action for cells that were already
        running on an instrument <i>before this system went live</i> — it is <b>not</b> part of normal weekly work,
        as the dialog&apos;s helper text says. It asks how many uses were already consumed (0–2 of 3), which
        barcodes were already burned, and optionally when the first use started. Register is disabled until you
        enter at least one burned barcode.
      </p>

      <p className={styles.subheading}>Cell detail page</p>
      <p>
        Opened from a cell chip or cell code, it&apos;s titled with the cell&apos;s code and its status badge (plus
        the <CellTypeBadge cellType="sprq" /> badge for a single-use cell); the <b>◂</b> link above the title returns
        to the Cells list — to the same search, filters and page when you came from there. Below that it shows:
      </p>
      <ul>
        <li>
          <b>Uses</b> spent / total and remaining; <b>Current location</b> (instrument · well); <b>First use
          started</b> and <b>Created</b> timestamps; and the cell&apos;s <b>Burned barcodes</b>. While the cell is
          still tracking its window (not yet Exhausted, Retired, or Stopped), a 108-hour window meter replaces the
          plain numbers, showing elapsed hours toward the limit; otherwise plain{" "}
          <b>Window elapsed</b> and <b>Window breached</b> values are shown instead. A <b>stopped</b> or{" "}
          <b>retired</b> cell also shows a note with the reason it was taken out of service and the date it happened.
        </li>
        <li>
          <b>Cell QC…</b> opens the quality-control dialog for the cell, with three actions (each takes an optional
          reason note):
          <ul>
            <li>
              <b>Fail cell</b> — the current run produced no usable data, but the cell is physically fine and keeps
              its other scheduled uses. Only that one sample is affected.
            </li>
            <li>
              <b>Fail and stop cell</b> — the run failed <i>and</i> the cell is out of service (e.g. visibly damaged);
              its later scheduled uses can no longer run on it.
            </li>
            <li>
              <b>Retire cell</b> — take the cell out of service <i>without</i> failing the current run; its later
              scheduled uses can no longer run on it.
            </li>
          </ul>
        </li>
        <li>
          <b>What happens to the affected samples.</b> The instrument loads samples as a continuous queue, so stopping
          or retiring a cell shifts its later samples forward onto the tray&apos;s remaining cells — and the last one
          or two may fall off the end. The dialog then asks you to decide each affected sample:
          <ul>
            <li>
              <b>Lost</b> — no usable material left; the sample is marked failed and goes to the Backlog&apos;s <b>Resupply requests</b> list so you can ask the supplier for fresh sample.
            </li>
            <li>
              <b>Complex</b> (Repeatable — from complex) — re-load straight from the leftover cleaned complex, no re-prep. The sample carries a 30-day countdown chip on the Backlog as a reminder to use the complex while it is fresh.
              Each row shows how much complex was loaded and how much is left; when at least the{" "}
              <i>safe repeat volume</i> remains (set in Settings → Scheduling) the row turns green and this option is
              pre-selected, otherwise it&apos;s flagged amber “at risk” (you can still choose it). If no complex volume
              was recorded, nothing is suggested.
            </li>
            <li>
              <b>Library</b> (Repeatable — from library) — not enough complex left, so re-make the complex from the library material held in Traction, then re-load. Use the{" "}
              <b>View library on Traction</b> link on the row to check the remaining library volume first.
            </li>
            <li>
              <b>Instrument</b> (Recoverable — from instrument) — the run&apos;s data can still be recovered from the instrument, so no new prep is needed; it goes back to the Backlog at Recoverable priority so it stays visible until dealt with.
            </li>
          </ul>
          Complex, Library and Instrument all go back to the Backlog above High priority, in its{" "}
          <b>Recoverable samples</b> section. Samples that simply ran on a <i>different</i> cell than planned are
          flagged for review — with a warning if the shift created a barcode clash — and left as they are unless you
          choose to route them too.
        </li>
        <li>
          <b>When Fail / Fail-and-Stop are available:</b> as soon as that run is locked in — someone has clicked{" "}
          <b>Confirm loaded</b> on the schedule grid. Retire is available on any open cell. Once a cell is stopped or
          retired the same button offers <b>Undo QC</b>, which reopens the cell and restores the samples it affected
          (a resupply request already marked sent is left in place).
        </li>
        <li>
          <b>Use history</b> lists every run the cell has been in: run name if one was set, otherwise its number
          (links to the run), well, use status (with <b>reassigned</b> / <b>clash</b> flags when a QC action shifted a
          sample onto this cell), Pool ID (links to that sample&apos;s page), barcodes, priority, target OPLC,
          adaptive loading, full resolution base Q, include base kinetics, instrument, start/complete times, and
          outcome notes.
        </li>
      </ul>

      <p className={styles.subheading}>PacBio credit</p>
      <p>
        Once a cell has a Failed use or is Stopped, a <b>PacBio credit</b> card appears on its detail page. It&apos;s
        laid out like a parcel tracker: a row of five connected stages runs left to right —{" "}
        <b>Failure → PacBio report → Internal report → Credit confirmed → Credit received</b>. Completed stages turn
        green and show the date they happened; the next stage you need to act on is highlighted, and the action for
        just that stage appears in the panel below the tracker. The card stays pinned to the <b>top</b> of the page
        for the life of the cell — marked <b>Open</b> while the case is live, switching to a <b>Credit received</b>{" "}
        badge once credit is marked received.
      </p>
      <p>
        While the case is open, the panel shows an <b>Expected reimbursement</b> figure — the acquisitions PacBio
        should credit, worked out as the failed acquisition plus the cell&apos;s remaining acquisitions (counted to
        the cell&apos;s maximum, ignoring any early tray discard). Hovering it explains the sum. It&apos;s a guide for
        the email and the credit you chase; the number you actually record at <b>Credit confirmed</b> is whatever
        PacBio confirm.
      </p>
      <ul>
        <li>
          <b>Failure</b> — set automatically the moment the cell is failed or stopped in Cell QC. This starts the
          credit workflow; the date shown is when the triggering use failed.
        </li>
        <li>
          <b>PacBio report</b> — comes first, because the case number PacBio issues feeds the internal report.{" "}
          <b>Add case number</b> records the case number from the quality log you raise, and moves the cell off the{" "}
          <b>Unreported</b> filter on the Cells page. <b>Generate email…</b> drafts an email to PacBio support in your
          own email client, filled in from the failing cell — by default the affected sample, run, instrument, date
          and the expected acquisitions to credit (taken from the Failed use, or the most recent use if the cell was
          Stopped without one). The recipients, subject and wording all come from the editable template on the{" "}
          <b>Settings</b> tab&apos;s <b>Email template</b>, so you can change them there. Review the draft — including who it&apos;s
          addressed to — before sending.
        </li>
        <li>
          <b>Internal report</b> — <b>Add report ID</b> records the ID your internal write-up of the failure is filed
          under (e.g. <b>26_NC_S_004</b>) and completes this stage. <b>Generate report ▾</b> opens a small menu with
          two ways to hand the failure to the issue-tracking sheet: <b>Copy to clipboard</b> copies one tab-separated
          row you can paste straight in as a new line, and <b>Download CSV</b> saves the same report as a file (a
          header row plus a value row). Either way a popup confirms it worked and shows every column and value it
          filled in — the occurrence date, the problem statement (run, well and use number of the failed cell), the
          PacBio case number, the sample id, and the instrument&apos;s asset number and location — so you can check
          it before pasting. If your browser blocks the automatic copy, that same popup lets you select and copy the
          values by hand. Once an ID is saved, it appears as <b>Report …</b> under the stage.
        </li>
        <li>
          <b>Credit confirmed</b> — once PacBio confirms how many acquisitions they will credit, enter that number
          and press <b>Record credit</b>. The box is pre-filled with the expected figure — change it if PacBio
          confirmed a different number. The count is shown under the stage (e.g. <b>2 acquisitions credited</b>).
        </li>
        <li>
          <b>Credit received</b> — <b>Mark as received in lab</b> once the credit has physically landed. Until this
          is done, the cell shows on the <b>Awaiting credit</b> filter on the Cells page.
        </li>
      </ul>
      <p>
        <b>Case notes</b> — a free-text note sits under the tracker&apos;s action panel and can be added or edited at{" "}
        <b>any stage</b>, from Failure through Credit received. Type your note and press <b>Save note</b> (it reads{" "}
        <b>Update note</b> once one exists); it&apos;s kept with the case as it moves through the workflow. (On the QC
        worklist, expand a row with the <b>▸</b> to edit its note.)
      </p>
      <p>
        <b>Owner and corrections</b> — above the notes, a <b>Recorded</b> line shows the case&apos;s <b>Owner</b>{" "}
        (whoever is chasing it, as a Sanger ID or a name) and each value already saved: the case number, report ID and
        acquisitions credited. Click <b>✎</b> beside any of them to fix it in place — correcting a value never changes
        the date that step was done. The owner also shows on the QC worklist and fills the <b>Reported by (Sanger
        ID)</b> column of <b>Generate report</b>; your name from the top bar is offered as a suggestion.
      </p>
      <p>
        A credit that isn&apos;t tied to a cell RunNx tracks is logged on the <b>QC</b> tab with{" "}
        <b>+ Add case without a cell</b> instead — see the QC section.
      </p>
    </div>
  );
}

import { CellStatusCard } from "@/components/cells/CellStatusCard";

import styles from "../HelpPage.module.css";
import { EXAMPLE_CELL_UNREPORTED } from "./helpFixtures";

export function CellsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> browsing every physical SMRT cell the system knows about and its current
        state.
      </p>

      <p className={styles.subheading}>Now vs End of week</p>
      <p>
        A big <b>Showing data as of</b> toggle at the very top switches every time-based figure on the page between{" "}
        <b>Now</b> and <b>End of week</b> (this week&apos;s Friday). It changes how each cell reads: a cell whose next
        uses are still <i>scheduled</i> for later this week shows those uses as not-yet-spent under <b>Now</b>, but
        counted under <b>End of week</b> — so a cell can read &quot;1 / 3 · Open&quot; now and &quot;3 / 3 ·
        Exhausted&quot; by Friday. The 108-hour window and status badges shift the same way, letting you see at a glance
        which cells will be spent or window-expired by the end of the week. It&apos;s a view only — nothing is changed on
        the cell; the Schedule grid remains the place placements actually happen.
      </p>

      <p className={styles.subheading}>Search, filters, sort &amp; grouping</p>
      <p>
        The big <b>Search</b> box at the top matches <i>any</i> id associated with a cell — its own code, its tray
        (type <b>T123</b> or just <b>123</b>), a container ID, a barcode, a run name or run number (<b>#45</b>), or the
        instrument it ran on — so whatever id you have to hand finds the cell that touched it.
      </p>
      <p>
        The chips (All, Open, Exhausted, Window expired, Retired, Stopped, Unreported, Awaiting credit) filter the
        list; the instrument dropdown narrows to one instrument. The page opens on <b>Open</b> cells by default.{" "}
        <b>Unreported</b> and <b>Awaiting credit</b> cut across the ordinary status filters - they show cells with a QC
        issue (see below) at a particular stage of the PacBio credit workflow, regardless of their Open/Exhausted/etc.
        status.
      </p>
      <p>
        <b>Sort</b> orders the cells by cell code, last run date, instrument, window remaining, or date created; the{" "}
        <b>▲/▼</b> button next to it flips the direction. <b>Group</b> arranges them into labelled sections — by{" "}
        <b>Tray</b> (the default, so a physical tray&apos;s four cells sit together in position order, its header
        linking to that tray&apos;s filtered view and flagging its soonest window expiry), by <b>Instrument</b>, by <b>Status</b>, or{" "}
        <b>No grouping</b> for one flat grid. When grouped by tray, each tray&apos;s four cells are framed together as
        the <b>physical tray</b> they&apos;re loaded on, with any unloaded position shown as an empty well. An{" "}
        <b>Expand all</b> toggle opens every card&apos;s details at once; otherwise a card reveals its details when you
        hover or keyboard-focus it.
      </p>

      <p className={styles.subheading}>Trays</p>
      <p>
        A physical SPRQ-Nx SMRT Cell tray holds 4 cells. There isn&apos;t a separate tray screen — clicking a{" "}
        <b>tray id</b> anywhere in the app (a cell card, a cell&apos;s detail page, a seal popover, or the Schedule
        grid&apos;s instrument cell map) opens this same <b>Cells</b> tab <i>filtered to that one tray</i>. That view
        shows the tray&apos;s instrument, how many of its cells are present, its soonest window expiry, and the tray&apos;s
        cells as the usual cell cards — plus a <b>Discard all cells</b> button. Use the <b>All cells</b> link to
        return to the full list. (This physical &quot;tray&quot; is a different thing from the
        Schedule grid&apos;s &quot;Plate 1&quot;/&quot;Plate 2&quot; loading positions within a run - see the Schedule
        section.)
      </p>
      <p>
        <b>Discard all cells:</b> the tray view carries a <b>Discard all cells</b> button that force-closes
        every cell still physically in that tray, cancelling
        any not-yet-run placements for those cells (their samples return to the backlog) and marking every cell
        exhausted regardless of how many uses it has left. It&apos;s only offered while at least one cell in the tray
        is still open. Use it when a tray is being pulled from the instrument for good and its remaining capacity
        won&apos;t be used. This cannot be undone.
      </p>
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
      <p>
        <b>Reuse skipped (planning a disposal):</b> if you already know you&apos;ll bin a part-used tray but haven&apos;t
        physically pulled it yet, you can flag it from the Schedule tab&apos;s <b>Autoschedule</b> panel (its{" "}
        <b>Reuse this week</b> list) so Auto Schedule stops reusing it and opens fresh cells instead. A tray flagged that
        way shows a <b>Reuse skipped</b> badge here. It&apos;s a reversible <i>plan</i> only — no cell status changes and
        nothing is thrown away until you actually <b>Discard all cells</b>; clearing the flag lets the tray be reused
        again.
      </p>

      <p className={styles.subheading}>Cell cards &amp; the 108-hour window</p>
      <p>
        <b>At a glance, each cell card shows three things:</b> a <b>108-hour window ring</b> on the left whose centre
        reads the <b>hours left</b> before the cell&apos;s reuse window closes — the ring fills as time passes and shifts
        green → amber (under ~a day left) → red (over); the <b>cell code</b> and <b>status badge</b> with an{" "}
        <b>n / 3 uses</b> count in the middle (e.g. <b>C02-T123</b> — cells are <i>numbered</i> 1–4 by their fixed tray
        position, and <b>T123</b> is that tray&apos;s id; click the code for the cell&apos;s full detail); and a
        colour-coded <b>foil stub</b> on the right edge naming the physical cell (<b>▣1</b>–<b>▣4</b>) and its current
        use number, tinted magenta / blue / teal for use 1 / 2 / 3. Terminally done cells (exhausted, retired, stopped)
        show a neutral ring with no countdown.
      </p>
      <p>
        <b>Hover a card</b> (or flip <b>Expand all</b>) to open its details: which instrument and well it&apos;s in, its{" "}
        <b>tray</b>, its burned barcodes, a <b>QC badge</b> (Unreported / Awaiting credit) when the cell has an open
        PacBio-credit case, a <b>Cell life</b> timeline plotting when each use broke out across the 108-hour window, and
        a <b>Samples &amp; runs</b> list <i>grouped by run</i> — each run name heads its own line with the sample(s) it
        carried beneath, each tagged <b>[1]</b>/<b>[2]</b>/<b>[3]</b> for which use it was, its use status (so you can
        tell an already-run use from one still <i>scheduled</i>), and its <b>container ID</b>.
      </p>
      <p>
        <b>Everything on the card links through:</b> the cell code to its detail page, the instrument to that
        instrument&apos;s cells, the tray to <b>that tray&apos;s cells</b> (this tab filtered to the tray), each container
        ID to that <b>sample&apos;s page</b>{" "}
        (its full metadata and every cell/run it has touched), and each run to its <b>run page</b> — so you can hop
        straight from a cell to any sample or run associated with it and back.
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <CellStatusCard cell={EXAMPLE_CELL_UNREPORTED} />
          </div>
          <span>
            <b>The 108-hour window</b> is the lifetime a multi-use cell has from its first use to the start of its
            third use. The window <b>ring</b> reads the hours left in that budget and turns amber as it runs low, red
            once breached; exhausted, retired, and stopped cells show a neutral ring with no countdown. Hover the
            example card to open its details.
          </span>
        </div>
      </div>
      <p>
        <b>Register in-progress cell</b> (button, top right) is a one-off setup action for cells that were already
        running on an instrument <i>before this system went live</i> — it is <b>not</b> part of normal weekly work,
        as the dialog&apos;s helper text says. It asks how many uses were already consumed (0–2 of 3), which
        barcodes were already burned, and optionally when the first use started. Register is disabled until you
        enter at least one burned barcode.
      </p>

      <p className={styles.subheading}>Cell detail page</p>
      <p>Opened from a card, it shows:</p>
      <ul>
        <li>
          <b>Uses</b> spent / total and remaining; <b>Current location</b> (instrument · well); <b>First use
          started</b> and <b>Created</b> timestamps; and the cell&apos;s <b>Burned barcodes</b>. While the cell is
          still tracking its window (not yet Exhausted, Retired, or Stopped), the same 108-hour window meter as the
          cards list replaces the plain numbers, showing elapsed hours toward the limit; otherwise plain{" "}
          <b>Window elapsed</b> and <b>Window breached</b> values are shown instead. A <b>stopped</b> or{" "}
          <b>retired</b> cell also shows a note with the reason it was taken out of service and the date it happened.
        </li>
        <li>
          <b>Cell QC</b> opens the quality-control dialog for the cell, with three actions (each takes an optional
          reason note):
          <ul>
            <li>
              <b>Fail Cell</b> — the current run produced no usable data, but the cell is physically fine and keeps
              its other scheduled uses. Only that one sample is affected.
            </li>
            <li>
              <b>Fail and Stop Cell</b> — the run failed <i>and</i> the cell is out of service (e.g. visibly damaged);
              its later scheduled uses can no longer run on it.
            </li>
            <li>
              <b>Retire Cell</b> — take the cell out of service <i>without</i> failing the current run; its later
              scheduled uses can no longer run on it.
            </li>
          </ul>
        </li>
        <li>
          <b>What happens to the affected samples.</b> The instrument loads samples as a continuous queue, so stopping
          or retiring a cell shifts its later samples forward onto the tray&apos;s remaining cells — and the last one
          or two may fall off the end. The dialog then asks you to decide each affected sample: <b>Lost</b> (needs
          fresh material — goes to the <b>Top-up required</b> list on the Backlog) or <b>Repeatable</b> /{" "}
          <b>Recoverable</b> (back to the Backlog above High priority, in its <b>Recoverable Samples</b> section).
          Samples that simply ran on a <i>different</i> cell than planned are flagged for review — with a warning if
          the shift created a barcode clash — and left as they are unless you choose to route them too.
        </li>
        <li>
          <b>When Fail / Fail-and-Stop are available:</b> as soon as that run is locked in — someone has clicked{" "}
          <b>Confirm loaded</b> on the schedule grid. Retire is available on any open cell. Once a cell is stopped or
          retired the same button offers <b>Undo QC</b>, which reopens the cell and restores the samples it affected
          (a top-up whose request was already sent is left in place).
        </li>
        <li>
          <b>Use history</b> lists every run the cell has been in: run name if one was set, otherwise its number
          (links to the run), well, use status (with <b>reassigned</b> / <b>clash</b> flags when a QC action shifted a
          sample onto this cell), container ID (links to that sample&apos;s page), barcodes, priority, target OPLC,
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
          <b>Admin → Email template</b> tab, so you can change them there. Review the draft — including who it&apos;s
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
          and press <b>Record credit</b>. The box is pre-hinted with the expected figure, but record what PacBio
          actually confirm. The count is shown under the stage (e.g. <b>2 acquisitions credited</b>).
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
    </div>
  );
}

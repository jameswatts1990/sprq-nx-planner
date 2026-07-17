import styles from "../HelpPage.module.css";

export function CellsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> browsing every physical SMRT cell the system knows about and its current
        state.
      </p>
      <p>
        <b>Filters:</b> the chips (All, Open, Exhausted, Window expired, Retired, Stopped, Unreported, Awaiting
        credit) filter the list; the dropdown filters by instrument; <b>Search</b> matches cell code or barcode. The
        page opens on <b>Open</b> cells by default. <b>Unreported</b> and <b>Awaiting credit</b> cut across the
        ordinary status filters - they show cells with a QC issue (see below) at a particular stage of the PacBio
        credit workflow, regardless of their Open/Exhausted/etc. status.
      </p>
      <p>
        <b>Each cell card shows:</b> the cell code (e.g. <b>CELL-A004821</b> — the letter is the cell&apos;s fixed
        position within its physical tray, A–D, not a status or location code), a status badge, uses spent (e.g.
        &quot;1 / 3 uses&quot;), which
        instrument and well it&apos;s currently in, its burned barcodes, and a 108-hour window meter. Click a card
        to open its full detail.
      </p>
      <p>
        <b>The 108-hour window</b> is the lifetime a multi-use cell has from its first use to the start of its
        third use; the meter fills toward 108 h and turns over-limit if breached. Exhausted and retired cells
        don&apos;t show a meter.
      </p>
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
          <b>Window elapsed</b> and <b>Window breached</b> values are shown instead.
        </li>
        <li>
          <b>Cell tray</b> card: SPRQ-Nx SMRT Cells ship in a physical tray of 4. The moment any one cell in a tray
          gets a sample, all 4 are registered together, in cell-number order - this card lists the tray&apos;s other
          cells (with a link, status, and uses) so you can see at a glance which are still available, even before
          their own first use. Not shown for cells created before this feature, or via Register in-progress cell,
          since those have no known tray. (This is a different &quot;tray&quot; from the Schedule grid&apos;s
          &quot;Tray 1&quot;/&quot;Tray 2&quot; loading positions - see the Schedule section.)
        </li>
        <li>
          <b>Retire cell</b> takes a cell permanently out of service. It&apos;s disabled — with a hover explanation
          — when the cell still has planned (not-yet-started) uses (&quot;Cannot retire a cell with planned (not
          yet started) uses.&quot;) or is already retired (&quot;Cell is already retired.&quot;). Remove or complete
          its planned uses first if you need to retire it.
        </li>
        <li>
          <b>Stop cell</b> is the QC action for a cell that has failed physically (e.g. visibly damaged) and can
          never be used again. Unlike Retire, it doesn&apos;t require you to clear planned uses first — confirming
          it cancels every not-yet-run use of that cell and returns those samples to the Backlog for rescheduling
          (a note reports how many); uses that already ran are kept untouched as history. Once stopped, the cell
          will never be offered again for reuse, including by Auto Schedule.
        </li>
        <li>
          <b>Undo stop</b> appears once a cell is stopped, in place of Stop cell. Confirming it reopens the cell
          and restores every use it cancelled back to Planned. If a sample from one of those uses has since been
          requeued or rescheduled onto a fresh placement elsewhere, that one use is deliberately left cancelled
          instead of being revived — reviving it would double-book that sample against wherever it landed.
        </li>
        <li>
          <b>Use history</b> lists every run the cell has been in: run number (links to the run), well, use status,
          sample, container ID, barcodes, priority, target OPLC, adaptive loading, full resolution base Q, kinetics
          (CCS output includes kinetics information), instrument, start/complete times, outcome notes, and{" "}
          <b>Mark Failed</b> / <b>Mark Aborted</b> actions.
        </li>
        <li>
          <b>Mark Failed</b> means that particular run produced no usable data and the cell itself may be at fault;
          the cell stays open for its other uses, and the sample is marked Failed and can be requeued to the
          Backlog from the Samples list.
        </li>
        <li>
          <b>Mark Aborted</b> is for when the run/instrument was the problem, not the cell or sample — e.g. an
          instrument fault mid-run. The cell stays open for its other uses, and unlike Mark Failed the sample goes
          straight back to the Backlog for rescheduling, with no separate Requeue step needed.
        </li>
        <li>
          <b>When Mark Failed/Mark Aborted become available:</b> as soon as that run is locked onto the
          instrument — its scheduled start time — not only once someone has clicked <b>Confirm loaded</b>. A
          problem can occur at any point once a cell is actually on the instrument, so QC doesn&apos;t wait on that
          confirmation step. Both are hidden for a run that hasn&apos;t reached its scheduled start yet, and for
          uses that were cancelled or already have a recorded outcome (Failed or Aborted).
        </li>
        <li>
          <b>Undo Failed</b> / <b>Undo Aborted</b> replace Mark Failed/Mark Aborted in the Actions column once a
          use has that verdict recorded. Confirming restores the use (and its sample) to how they looked
          beforehand. The button itself disappears again once the sample has since been requeued or rescheduled
          onto a fresh placement elsewhere — undoing at that point would double-book that sample, so it stops
          being offered rather than failing with an error; reschedule from the Backlog instead in that case.
        </li>
      </ul>

      <p className={styles.subheading}>PacBio credit</p>
      <p>
        Once a cell has a Failed use or is Stopped, a <b>PacBio credit</b> card appears on its detail page so you
        can track the case through to a physical credit:
      </p>
      <ul>
        <li>
          <b>Report to PacBio</b> — enter the case number PacBio issues when you raise the quality log, then submit.
          This is what moves the cell off the <b>Unreported</b> filter on the Cells page.
        </li>
        <li>
          <b>Confirm credit</b> — tick this once PacBio has confirmed a credit will be issued for that case.
        </li>
        <li>
          <b>Mark credit received</b> — tick this once the credit has physically landed in the lab. Cross-reference
          by the case number shown on the card. Until this is ticked, the cell shows on the <b>Awaiting credit</b>{" "}
          filter on the Cells page.
        </li>
      </ul>
    </div>
  );
}

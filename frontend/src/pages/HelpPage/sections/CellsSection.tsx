import { CellStatusCard } from "@/components/cells/CellStatusCard";
import { WindowMeter } from "@/components/cells/WindowMeter";

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
        linking to the tray page and flagging its soonest window expiry), by <b>Instrument</b>, by <b>Status</b>, or{" "}
        <b>No grouping</b> for one flat grid.
      </p>

      <p className={styles.subheading}>Trays</p>
      <p>
        A physical SPRQ-Nx SMRT Cell tray holds 4 cells. There isn&apos;t a separate tray screen — clicking a{" "}
        <b>tray id</b> anywhere in the app (a cell card, a cell&apos;s detail page, a seal popover, or the Schedule
        grid&apos;s instrument cell map) opens this same <b>Cells</b> tab <i>filtered to that one tray</i>. That view
        shows the tray&apos;s instrument, how many of its cells are present, its soonest window expiry, and the tray&apos;s
        cells as the usual cell cards — plus a <b>Discard all cells</b> button. Use the <b>◂ All cells &amp;
        instruments</b> link to return to the full list. (This physical &quot;tray&quot; is a different thing from the
        Schedule grid&apos;s &quot;Plate 1&quot;/&quot;Plate 2&quot; loading positions within a run - see the Schedule
        section.)
      </p>
      <p>
        <b>Discard all cells:</b> the tray view has a <b>Discard all cells</b> button that force-closes every cell
        still physically in that tray - cancelling any not-yet-run placements for those cells (their samples return
        to the backlog) and marking every cell exhausted regardless of how many uses it has left. Use it when a
        tray is being pulled from the instrument for good and its remaining capacity won&apos;t be used. This cannot
        be undone.
      </p>
      <p>
        <b>Auto Schedule disposes whole trays too:</b> a tray of 4 is one physical object — it&apos;s thrown away as
        a unit, never one cell at a time. So when you auto-schedule, a tray is disposed automatically only once{" "}
        <b>every</b> cell in it has been used to your <b>Max uses per cell</b> setting; all 4 cells then show as{" "}
        <b>Exhausted</b> together, exactly like a manual discard, and are never offered for reuse again. A tray still
        holding an unused or below-target cell is left alone (every cell stays open) until a later run finishes it.
        Disposed cells keep their already-scheduled runs; only the spare capacity is closed off.
      </p>

      <p className={styles.subheading}>Cell cards &amp; the 108-hour window</p>
      <p>
        <b>Each cell card shows:</b> the cell code (e.g. <b>C02-T123</b> — cells are <i>numbered</i> 1–4 by their fixed
        position in the physical tray, and <b>T123</b> is that tray&apos;s id, so a tray&apos;s four cells read{" "}
        <b>C01-T123</b> … <b>C04-T123</b>; click it to open the cell&apos;s full detail), a status badge, uses spent,
        which instrument and well it&apos;s currently in, its <b>tray</b>, its burned barcodes, and a 108-hour window
        meter. A <b>Samples &amp; runs</b> list at the foot of each card shows every sample the cell has carried — its
        use status (so you can tell an already-run use from one still <i>scheduled</i>), its <b>container ID</b>, and
        the <b>run</b> it ran on.
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
            third use; the meter fills toward 108 h and turns over-limit if breached. Exhausted and retired cells
            don&apos;t show a meter.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <WindowMeter windowHours={112} />
          </div>
          <span>The same meter once the 108-hour budget is breached - the fill turns red past the limit.</span>
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
          <b>Window elapsed</b> and <b>Window breached</b> values are shown instead.
        </li>
        <li>
          <b>Cell tray</b> card: SPRQ-Nx SMRT Cells ship in a physical tray of 4. The moment any one cell in a tray
          gets a sample, all 4 are registered together, in cell-number order - this card shows the tray&apos;s cells as
          the same cards as the main list (the one you&apos;re viewing highlighted), so you can see at a glance which are
          still available, even before their own first use. Its heading opens the full <b>tray view</b> (this tab
          filtered to the tray), also reachable from a cell&apos;s seal popover and the grid&apos;s instrument cell map.
          Not shown for cells created before this feature, or via Register in-progress cell, since those have no known
          tray.
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

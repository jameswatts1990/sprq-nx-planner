import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { Badge } from "@/components/ui/Badge";
import { RunWellStrip } from "@/pages/HistoryRunsPage/RunWellStrip";
import { SampleRunChips } from "@/pages/HistorySamplesPage/SampleRunChips";
import { CYCLE_STATUS_TONE, RUN_STATUS_LABEL } from "@/utils/cycleStatus";

import styles from "../HelpPage.module.css";
import { EXAMPLE_RUN_WELLS, EXAMPLE_SAMPLE_USES, STAGE_EXAMPLE_SOURCE } from "./helpFixtures";

export function HistorySection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>Runs</b>, <b>Samples</b> and <b>Activity</b> (all under the <b>History ▾</b> menu) work just like <b>Cells</b>: a search
        box and filters across the top, <b>Rows</b> per page on the right, one row per run or sample with its contents shown as coloured chips,
        and rows that expand in place. Your search, filters, sort and page are kept in the page address, so{" "}
        <b>Back</b> from a run, cell or sample returns you to exactly the same list — and you can bookmark or share a
        filtered view.
      </p>

      <p className={styles.subheading}>History → Runs</p>
      <p>
        <b>What it&apos;s for:</b> a record of every sequencing run — past, active and planned — with how each well
        went at a glance. It opens with the newest load date first.
      </p>
      <p>
        <b>Columns:</b> <b>Run</b> (its name if one was given at <b>Confirm loaded</b>, otherwise its number, shown
        as <b>#45</b>; click it to open the run), <b>Load date</b>, <b>Instrument</b>, <b>Chemistry</b>, its{" "}
        <b>Status</b>, a chip for each of its <b>Wells</b>, the <b>Movie</b> length (its longest plate) and{" "}
        <b>Loaded at</b> — the real time entered at <b>Confirm loaded</b>, or its start time marked{" "}
        <b>planned</b> while it hasn&apos;t been loaded yet.
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <RunWellStrip wells={EXAMPLE_RUN_WELLS} />
          <span>
            <b>The well chips.</b> One group per plate (<b>P1</b>, <b>P2</b>) with a chip per well A–D, coloured like
            that well&apos;s use-status badge: green completed, blue running, grey planned, amber aborted, orange
            failed, and red <b>blocked</b> (a later use lost because its cell was stopped). A dashed chip is a well
            with nothing loaded. Hover a chip for the sample, the cell and which use of it this was; click it to open
            the cell.
          </span>
        </div>
      </div>
      <p>
        <b>Click a row</b> (or its <b>▸</b>) to expand it: each well with its cell (tagged <b>[1]</b>/<b>[2]</b>/
        <b>[3]</b> for which use of the cell it was), its sample, barcodes, use status and start / complete times,
        linking to the cell and the sample.
      </p>
      <p>
        <b>Search</b> matches the run itself — its name, number (<b>#45</b>), instrument or load date — or anything
        on its wells: a Pool ID, Sanger ID or Plate ID, a barcode, a cell code, or a tray (<b>T12</b>). The wells
        that matched are ringed in the chips and highlighted when the row is expanded; a search with a single hit
        opens that run straight away. The dropdowns filter by <b>status</b>, <b>chemistry</b> and{" "}
        <b>instrument</b>, and <b>Loaded between</b> limits it to a load-date range (<b>Any date</b> clears it).{" "}
        <b>Click a column heading</b> (Run, Load date, Instrument) to sort by it; click again to flip the direction
        (▲/▼).
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.planned}>{RUN_STATUS_LABEL.planned}</Badge>
          </span>
          <span>Scheduled but not yet loaded.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.running}>{RUN_STATUS_LABEL.running}</Badge>
          </span>
          <span>Confirmed loaded / currently sequencing.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.completed}>{RUN_STATUS_LABEL.completed}</Badge>
          </span>
          <span>The run has finished — every cell is through sequencing and analysis. A loaded run turns completed automatically once its scheduled time is up.</span>
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatchLabel}>
            <Badge tone={CYCLE_STATUS_TONE.aborted}>{RUN_STATUS_LABEL.aborted}</Badge>
          </span>
          <span>The run was stopped or cancelled.</span>
        </div>
      </div>
      <p>
        <b>Run detail page</b> is titled with the run&apos;s name (or its number, e.g. <b>Run #45</b>). The{" "}
        <b>◂</b> link above the title returns you to wherever you opened the run from — Run history (with your
        search and filters intact), a cell, a sample or the Cells tab; a direct link falls back to{" "}
        <b>◂ Run history</b>. It shows the run&apos;s instrument, load date, when it loads (its cells then prep before sequencing),
        status, and whether it&apos;s <b>Active now</b>, then a tray block per plate laid out just like the weekly
        schedule. Each plate&apos;s header carries an <b>→ acquire-day</b> tag next to its title when the plate
        sequences on a different day from loading (a reuse Plate 2 — you can tell it&apos;s a reuse because its cells&apos;
        stubs read <b>Use 2</b>/<b>3</b>), the planned start → end of its movie, and — once the run has actually run —
        the <b>actual</b> start/end recorded on the instrument. Each
        plate&apos;s four wells are drawn with the same colour-coded cards used on the schedule:
      </p>
      <div className={styles.ghostExampleSwatch}>
        <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} locked onOpenCell={() => {}} />
      </div>
      <p>
        <b>Click a card</b> to see that placement&apos;s detail (sample, well, run time, barcodes, notes). Click the
        shiny <b>cell stub</b> on the right edge of a card to open the physical cell — its uses so far, its 108-hour
        window, tray position, and burned barcodes — and from either you can open <b>Cell QC</b> to record how a use
        turned out. On a finished run these views are read-only; on a still-<i>planned</i> run you can adjust a
        cell&apos;s run time or switch a reuse to a fresh cell, exactly as on the schedule.
      </p>
      <p>
        <b>Cancel run</b> (top right) is available only while a run is still <i>planned</i>; once it&apos;s running/loaded it
        can&apos;t be cancelled from here. It asks first, saying how many samples go back to the backlog; the run is then
        deleted (a stopped cell&apos;s <b>Blocked</b> marker is kept) and you&apos;re taken back to where you came from.
      </p>

      <p className={styles.subheading}>History → Samples</p>
      <p>
        <b>What it&apos;s for:</b> every sample RunNx knows about, whatever its status — Backlog, Scheduled, In
        progress, Completed, Failed or Cancelled — and where each one is now. It opens with the most recently updated
        first. This is the fastest way to find out where a specific sample actually is: paste its Pool ID and its row
        shows its current status and every run it has been on.
      </p>
      <p>
        <b>Columns:</b> <b>Pool ID</b> (click it to open the sample&apos;s own page), <b>Status</b>, a chip for each
        of its <b>Runs</b>, its <b>Barcodes</b>, <b>Plate ID</b>, <b>Target OPLC</b>, <b>Actual OPLC</b>,{" "}
        <b>Priority</b> and when it was last <b>Updated</b>. A <b>1/3</b> badge by a Pool ID marks a duplicate — the
        same sample run across multiple cells (counted across every status, including completed).
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <SampleRunChips uses={EXAMPLE_SAMPLE_USES} />
          <span>
            <b>The run chips.</b> One chip per time the sample was placed on a cell: the run and the well (<b>P2</b>{" "}
            when it was on Plate 2), coloured like that use&apos;s status badge — here it was aborted on run #412, then
            re-run to completion. Hover a chip for the instrument, load date and cell; click it to open the run. A
            sample still waiting in the Backlog reads <b>Not placed yet</b>.
          </span>
        </div>
      </div>
      <p>
        <b>Click a row</b> (or its <b>▸</b>) to expand it: every cell use with its run, load date, instrument,
        plate, cell and well, use status, start / complete times and notes, linking to the run and the cell.
      </p>
      <p>
        <b>Search</b> matches Pool IDs, Sanger IDs, Plate IDs, barcodes and priorities; a search with a single hit
        opens that sample straight away. The <b>status</b> dropdown narrows the list to one status — or{" "}
        <b>Finished (completed or failed)</b> — and the <b>priority</b> dropdown to one priority.{" "}
        <b>Click a column heading</b> to sort by it; click again to flip the direction (▲/▼).
      </p>

      <p className={styles.subheading}>Sample detail page</p>
      <p>
        <b>What it&apos;s for:</b> a single sample (pool) on its own page, reached by clicking a <b>Pool ID</b>{" "}
        anywhere in the app — an expanded tray on the Cells tab, a cell&apos;s use history, or a row in the Samples list above. It&apos;s
        titled with the sample&apos;s Pool ID and its status badge, and shows the sample&apos;s full metadata (Plate ID,
        priority, Target OPLC, Actual OPLC, the loading volumes including the read-only <b>Library pool vol used</b>{" "}
        from import, movie time, loading options, barcodes, Sanger IDs, created/updated times) and a <b>Cell uses</b>{" "}
        table of every cell it has been
        placed on — the run (links to the run), plate, cell (links to the cell), well, use status, start/complete
        times, and notes. This page works for a sample of any status, so it&apos;s the durable place a Pool ID
        always links to.
      </p>
      <p>
        <b>Notes:</b> the sample&apos;s own free-text note sits at the bottom of its details. Click{" "}
        <b>✎ Add note</b> (or <b>✎ Edit note</b>) to write or change it in place, then <b>Save note</b> (or press{" "}
        <b>Ctrl+Enter</b>); saving an empty note removes it. Unlike the <b>Edit</b> button, this works for a sample of
        any status — a failed sample awaiting resupply, or a completed one. The same note shows under the Pool ID on
        the Backlog tab.
      </p>
      <p>
        <b>Back:</b> the <b>◂</b> link above the title returns you to wherever you opened the sample from — the Backlog,
        Schedule, a cell, a run, or the Samples list — rather than always to one fixed place. Opening the page directly (a
        shared link or a browser refresh) falls back to the Samples list.
      </p>
      <p>
        <b>View on Traction:</b> a <b>View on Traction</b> button at the top right of the page opens the sample in
        Traction — the pools view for a pool, the libraries view for a single — so you can check its remaining
        library material without leaving your place. It only appears when the sample has a Pool ID to link to.
      </p>
      <p>
        <b>Edit:</b> an <b>Edit</b> button at the top right of the page opens the same form used elsewhere. A backlog
        sample is fully editable (everything but its Pool ID, which is fixed for life); a sample already placed on
        the grid (scheduled or in progress) lets you adjust only its loading parameters, since its barcodes and
        identity are locked once placed. Finished samples (completed, failed, cancelled) are read-only history, so no
        Edit button is shown.
      </p>

      <p className={styles.subheading} id="activity">
        History → Activity
      </p>
      <p>
        <b>What it&apos;s for:</b> who changed what, and when. Every change made in RunNx — placing, moving or
        removing a sample, Autoschedule, confirming a run loaded or unlocking it, editing a sample or a note, an
        import, cell QC, a credit-case step, an instrument or a setting — is listed here, newest first.
      </p>
      <p>
        <b>Columns:</b> <b>When</b>, <b>Who</b> (the name set in the top bar — see Getting started; <i>Unknown</i>{" "}
        for a change made before a name was set), <b>What</b> was done, what it was <b>About</b> (links to the
        sample, run, cell, tray or instrument; a placement links all three of its sample, run and cell) and the{" "}
        <b>Details</b> it recorded. An edit shows each field it changed as <b>before → after</b>, e.g.{" "}
        <i>Priority: Standard (3) → High (1)</i>; saving a form without changing anything isn&apos;t recorded. Something
        since deleted (a sample removed by Undo import, a cancelled run) is named but no longer linked.
      </p>
      <p>
        <b>Filters:</b> the <b>search box</b> matches names, Pool IDs, notes, reasons, case numbers and anything else
        a change recorded; the dropdowns narrow it to one <b>kind of change</b> (Schedule, Runs loaded &amp; outcomes,
        Samples &amp; imports, Cells, trays &amp; QC, PacBio credits, Instruments, Settings) or to <b>who</b> made
        it, and <b>Changed between</b> limits it to a date range.
      </p>
      <p>
        <b>View activity</b> at the top right of a run, sample or cell page opens this list for just that run,
        sample or cell — including everything placed on it, even a placement that&apos;s since been removed. A
        highlighted line at the top says what it&apos;s showing; <b>Show all activity</b> lifts it.
      </p>
    </div>
  );
}

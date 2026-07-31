import { useState } from "react";

import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { RunDesignFields } from "@/pages/SchedulePage/RunDesignFields";
import type { RunDesignState } from "@/types/schedulerGrid";

import styles from "../HelpPage.module.css";
import {
  STAGE_EXAMPLE_ABORTED,
  STAGE_EXAMPLE_CANCELLED,
  STAGE_EXAMPLE_FAILED,
  STAGE_EXAMPLE_PEER,
  STAGE_EXAMPLE_SOURCE,
  STAGE_EXAMPLE_STOPPED,
  STAGE_EXAMPLE_UNRELATED,
  STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE,
} from "./helpFixtures";

/** The real, live Autoschedule controls - the same RunDesignFields the Schedule page's
 * Autoschedule drawer renders - wired to local state instead of the actual auto-fill/clear
 * mutations, purely for illustration (see CLAUDE.md's Help Tab Maintenance section). Shown
 * in a plain Card here rather than the drawer, which needs the Schedule page to open it. */
function RunDesignExample() {
  const [runDesign, setRunDesign] = useState<RunDesignState>({
    max_uses: 3,
    run_time_hours: 24,
    movie_times: [24],
    objective: "fewest",
    cells_per_day: 8,
    load_hour: 12,
  });
  return (
    <Card>
      <CardBody>
        <RunDesignFields
          runDesign={runDesign}
          onChange={setRunDesign}
          selectedCount={3}
          onAutoSchedule={() => {}}
          autoFilling={false}
          weekPlannedCount={5}
          onRequestClearSchedule={() => {}}
          note={null}
        />
      </CardBody>
    </Card>
  );
}

export function ScheduleSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> the weekly planning grid. Rows are your active instruments; columns are
        days. You place backlog samples into instrument/day slots here.
      </p>

      <p className={styles.subheading}>Moving through time</p>
      <p>
        <b>Prev</b> and <b>Next</b> page the view by 7 days; <b>Today</b> jumps back to the current window. The
        date range is shown between them, and it&apos;s remembered in the page URL so you can bookmark or share a
        week. The date field next to <b>Today</b> is a jump-to-date picker — pick any day and the view jumps
        straight to the Mon-Fri week that contains it, without paging through every week in between.
      </p>
      <p>
        <b>Weekends aren&apos;t shown</b> — the grid only has Monday-Friday columns, because runs aren&apos;t
        started at weekends.
      </p>
      <p>
        <b>A down instrument&apos;s days are greyed out.</b> From the date you mark an instrument down for maintenance
        (on the Instruments tab), each of its empty days shows a muted <b>Down</b> cell that can&apos;t be selected or
        dropped onto, so no new run can be scheduled there until you bring it back online. Runs already on it, and days
        before the down date, are left untouched.
      </p>
      <p>
        <b>The day headers are colour-coded to today.</b> Days already past are shown greyed, the current day is
        highlighted in rose pink with a magenta underline, and days still to come stay white — so you can see at a
        glance where &quot;now&quot; sits in the week. Past days stay fully editable; it&apos;s only a visual cue. The
        pink bar next to the <b>Weekly schedule</b> heading fills up like a progress bar, with the RunNx dot marking
        how far through the displayed week today is.
      </p>

      <p className={styles.subheading}>View options</p>
      <p>
        <b>View options</b> at the far right of the date toolbar opens a small menu of display toggles that change
        only how the grid is drawn, never the plan itself. Right now it holds one toggle — <b>Barcodes: Show / Hide</b>{" "}
        — which shows or hides the barcode chips on every sample card in the grid, handy for a cleaner, less busy view
        when you don&apos;t need the barcodes. It only affects the grid: barcodes still appear when you open a card&apos;s
        detail popover. Your choice is remembered next time you open the Schedule page.
      </p>

      <p className={styles.subheading}>Instrument cell map</p>
      <p>
        Beneath each instrument&apos;s <b>REVIO</b> number, the left column shows a small <b>map of the SMRT cells
        currently on that machine</b>, so you can see each instrument&apos;s cell stock at a glance without opening the
        Cells tab. It mirrors the deck: up to two tray boxes side by side — the left box is the <b>Plate 1</b> tray
        position, the right is <b>Plate 2</b> — each listing its four cells <b>▣1, ▣2, ▣3, ▣4</b> top to bottom (the{" "}
        <b>▣</b> mark distinguishes a numbered cell position from a lettered plate well).
      </p>
      <ul>
        <li>
          The big number on each position is that cell&apos;s <b>uses remaining</b> (of 3), and beneath it a coloured
          status icon + <b>DD/MM</b> gives the cell&apos;s <b>108-hour reuse deadline</b> with a short countdown (e.g.{" "}
          <i>2d left</i>). By default the number counts every use <b>scheduled this week</b> — what will be left once
          the week&apos;s plan has run; hover for the live <b>NOW</b> view (below) and it switches to what&apos;s left{" "}
          <b>right now</b>, counting only the uses that have actually broken out yet. A never-used cell reads{" "}
          <b>unused</b> (its clock hasn&apos;t started); a planned, not-yet-confirmed load shows its date with a{" "}
          <b>dotted underline</b> (it firms up once the run is confirmed loaded).
        </li>
        <li>
          <b>Each cell has its own deadline, not one shared date.</b> The instrument breaks a tray&apos;s four cells out
          about <b>2 hours apart</b> (and a second tray about <b>a day</b> after the first), and a cell&apos;s 108-hour
          clock starts at <i>its own</i> breakout — so the four cells expire on a staggered ladder, cell 1 first.
        </li>
        <li>
          Colour and icon show each cell&apos;s state at a glance: <b>green</b> = comfortably in window; <b>amber</b> =
          closing within about a day, so reuse it soon or lose the spare capacity; <b>red</b> = past its deadline or
          QC-stopped (unusable); <b>blue</b> = not broken out yet (its clock hasn&apos;t started); <b>grey</b> = used up
          or retired.
        </li>
        <li>
          A tray whose cells are <b>all used up or expired</b> doesn&apos;t disappear while it&apos;s still the tray in
          that position — it stays shown <b>fully greyed out</b> (every cell reading <b>0</b> uses left{" "}
          <i>by end of week</i>), because the physical tray is still sitting in the instrument until you swap it. Once a{" "}
          <b>fresh tray is loaded</b> into that position, the map shows the <b>fresh tray</b> instead — by the end of the
          week the used-up one has physically left the instrument.{" "}
          <b>Hover for the NOW view</b> and a used-up cell still comes back to life if its final use hasn&apos;t
          physically broken out yet — on today&apos;s run the cells break out a couple of hours apart, so right now only
          the ones already broken out read as spent; the rest still show the use they&apos;re holding.
        </li>
        <li>
          A dashed <b>&quot;load tray&quot;</b> box means that carousel position has <b>no tray loaded</b> — it&apos;s
          free for a fresh tray.
        </li>
        <li>
          By default each cell is shown <b>as it will stand at the end of the week</b> you&apos;re viewing — the pill
          above the trays reads e.g. <i>&quot;by Fri 24 Jul&quot;</i> — so you can see which cells will have expired by
          then, and the uses-remaining number reflects the <b>whole week&apos;s plan</b>. <b>Hover the map</b> to flip
          every cell to its status <b>right now</b>: colours, countdowns <i>and</i> the uses-remaining number all switch
          to the live reading, so a cell whose later uses haven&apos;t broken out yet shows the higher count it still
          physically has. A green <b>NOW</b> pill (with a spinning icon) marks the live view. Each slot shows the tray
          that&apos;s on the instrument <b>by the end of the week</b> — so if a position turns over mid-week, you see the
          fresh tray, not the one that has aged out.
        </li>
        <li>
          <b>Mid-week tray swaps.</b> When a tray ages out of its 108-hour window part-way through the week and the
          schedule loads a <b>fresh replacement</b> into the same position, the map shows the <b>replacement</b> — the
          tray actually on the instrument by the end of the week — in that slot, not the one that has aged out. You
          don&apos;t confirm anything: dropping a sample onto a day the current tray has expired loads a fresh tray
          automatically (see <i>Dropping a sample onto an empty slot</i>), and it shows up as the position&apos;s tray
          and as a new <b>Use 1</b> on the grid.
        </li>
        <li>
          Click a <b>TRAY #</b> heading to open the <b>Cells</b> tab
          filtered to that tray — its four cells, summary, and Discard action on one screen. Click an individual <b>cell</b> in a tray strip
          to open that cell&apos;s <b>detail page</b> — its full history, status, 108-hour window, and Cell QC actions
          all live there.
        </li>
      </ul>

      <p className={styles.subheading}>Recalculate</p>
      <p>
        The small <b>↻</b> button next to an instrument&apos;s REVIO number <b>re-derives every one of that
        instrument&apos;s not-yet-loaded placements from scratch</b>, reuse-before-new, exactly as if you&apos;d cleared
        them and let Auto Schedule place them again under today&apos;s rules. It&apos;s for the rare case where a
        schedule was worked out under a rule that&apos;s since been corrected, and needs re-packing to actually
        benefit from the fix — day-to-day scheduling never needs it. A confirmation dialog explains what it will do
        before anything changes; <b>confirmed/loaded runs are always left exactly as they are</b>, and it reaches
        every planned run on that instrument, not just the week you happen to be viewing. To actually reuse a cell
        instead of opening a new tray, it can push a sample onto a <b>later day it wasn&apos;t on before</b> — never
        earlier, and never touching a different instrument — whenever that lets fewer physical cells be used. In{" "}
        <b>2 plates per run</b> mode that later use often shows up as <b>Plate 2 of the very same run</b> its first
        use is in (see <i>Runs, plates &amp; wells</i> below), not a whole separate run card. Afterwards a note —
        shown directly on the schedule page, next to the weekly grid — reports how many samples were placed, how
        many (if any) moved to a different day, and how many, if any, couldn&apos;t be placed at all, naming their
        Container IDs: they stay safely in the Backlog, never lost, and can always be found from there or by
        pasting the Container ID into the Samples tab&apos;s search (which looks across every status, not just
        finished samples).
      </p>

      <p className={styles.subheading}>Print Batch Sheet</p>
      <p>
        <b>Print Batch Sheet</b> opens a printable loading sheet for the Revios. Pick the <b>load day</b> and tick which
        instruments to include — handy when different people load different machines, since each person can print
        just their own, then click <b>View Sheet</b> to open the printable sheet in a new tab. You get <b>one section per run</b>, and within it a table split into a block per plate: <b>Plate
        1</b>, then <b>Plate 2</b> if the run has one. Each plate block is headed with the day it sequences, e.g.{" "}
        <i>&quot;Plate 2 · acquires Fri 25 Jul · reuse (Use 2)&quot;</i> — so a reuse run&apos;s second plate, which the
        instrument runs the next day, is on the sheet too (both plates are loaded in the one session). Each well shows
        its cell code, use number and 108-hour reuse deadline, the sample to load and its <b>parent sample</b>, the
        per-cell run settings (movie / run time, adaptive loading, include base kinetics, full-resolution baseQ) and the
        <b> Actual OPLC</b>. Any setting that differs from the configured Sample Defaults (Admin tab) is shown in
        <b> bold with a &quot;*&quot;</b> so a non-standard value stands out; a footnote under the table explains the
        mark. Because run time is per-cell, each well shows its own movie time. Each run&apos;s page also has a
        <b> Date</b> and <b>Signed / initials</b> box top-right to sign off the load. A final <b>Notes</b> column prints
        any note you&apos;ve added to a sample on its cell (see <b>Sample notes</b> under QC actions below). Use the
        page&apos;s <b>Print / Save as PDF</b> button, which opens your browser&apos;s normal print dialog (choose a
        physical printer, or &quot;Save as PDF&quot;). The sheet prints <b>landscape, one run per page</b>, so each
        Revio&apos;s run is a self-contained page you can hand to whoever loads it. When you save to PDF the filename is
        pre-filled as <i>&quot;YYYY.MM.DD - Revio &lt;serial&gt;&quot;</i> (the load day and the instrument), so
        printing one Revio at a time gives a tidily named file per machine.
      </p>
      <p>
        Below each run&apos;s table the sheet also prints two <b>fill-in worksheets per plate</b> to record the bench
        work as you go; for a two-plate run the two plates&apos; worksheets sit <b>side by side</b> to make the most of
        the landscape page. The <b>7.3 · Final complex loading dilution</b> table has a row per well, pre-filled with the
        well and Traction ID. <b>Control Dilution 3</b> is always <b>1 µL</b> and is printed for you. If the sample has
        its complex and loading-buffer volumes — whether carried across when you upload from the scheduler sheet, or
        filled in on the sample&apos;s edit form — those boxes are pre-filled too; any the app doesn&apos;t have are left
        blank to write in at the bench. The <b>final volume</b> is worked out for you as complex + loading buffer + the
        1 µL control dilution 3 whenever the complex and loading-buffer volumes are known, otherwise left blank. The
        achieved <b>Actual OPLC</b> is pre-filled when it&apos;s been recorded
        on the sample, otherwise left blank to write in. The <b>7.4 · Plate loading</b> checklist (one per
        plate) has a space to note the plate&apos;s QR / serial number and the time loaded, tick boxes for the loading
        steps (humidity &gt;25%rH, tips refilled, deck reloaded, excess cells disposed) and a per-well tick for
        &quot;Control Dil. added&quot; and &quot;23 µL loaded&quot;. These are for writing on the printout by
        hand — the values aren&apos;t stored back in the app.
      </p>

      <p className={styles.subheading}>Export schedule</p>
      <p>
        <b>Export schedule</b> downloads the currently-visible week as a CSV in the exact column layout of the
        sequencing tracker Google Sheet, so you can paste the rows straight in. There is one row per scheduled well;
        the columns the planner tracks (date, run ID, instrument, Traction ID, barcodes, Sanger ID, cell location, run
        time, target OPLC, status and priority) are filled in, and every other column in the sheet is left
        blank for you to complete. Because the blanks would overwrite existing values, use this to <b>add new rows</b>{" "}
        to the sheet rather than to paste over rows that already have complexing or charging data.
      </p>
      <p>
        A <b>multiplexed pool</b> (a well with more than one barcode) is split into <b>one row per barcode</b>, so each
        sample in the pool gets its own line — with its barcode, its matching Sanger ID, the pool&apos;s Traction ID in{" "}
        <b>Pool ID</b>, and an equal <b>Portion of SMRT Cell</b> (four barcodes = 25% each). Splitting only happens when
        the number of barcodes matches the number of Sanger IDs; if they don&apos;t line up, the pool stays on a single
        row and a note in <b>Sequencing Comments</b> tells you it wasn&apos;t split (e.g. &quot;Not split: 4 barcodes /
        1 Sanger IDs&quot;) so you can correct the sample and export again.
      </p>

      <p className={styles.subheading}>Autoschedule (run design &amp; auto-fill)</p>
      <p>
        The pink <b>✦ Autoschedule</b> button in the <b>Backlog</b> panel header opens the <b>Autoschedule</b>{" "}
        panel — a pop-out from the left edge — which sets the parameters used for both single placements and auto-fill.
        Close it with the <b>✕</b>, the <b>Esc</b> key, or by clicking outside it; your grid selection stays put while
        it&apos;s open. The same controls are shown live below:
      </p>
      <dl className={styles.terms}>
        <dt>Max uses per cell (1× / 2× / 3×)</dt>
        <dd>
          The <b>total</b> number of times each SMRT cell may be used — first run plus reuses (so 2× means one
          initial run and one reuse). A cell physically supports up to 3 acquisitions. This is always honored in
          full — it&apos;s only reduced automatically if you select fewer days than the chosen use count, since a
          cell can&apos;t be reused twice on the same day. When auto-scheduling, this acts as a lifetime cap on the
          whole physical tray: a tray of 4 loads and is thrown away as one unit, so once <b>every</b> cell in a tray
          has been used the chosen number of times, the whole tray is <b>disposed</b> together (all 4 cells marked
          Exhausted, never offered for reuse again). A tray still holding an unused or below-target cell stays on the
          instrument — all its cells kept open — for a later run to finish and then dispose as a unit; a tray is
          never part-binned.
        </dd>
        <dt>Movie times (12 / 24 / 30 h)</dt>
        <dd>
          Tick which sample <b>movie lengths</b> Auto Schedule should include — only <b>24 h</b> is ticked by default.
          A movie length is a <b>per-sample</b> setting (12/24/30 h, set on the backlog or on import, defaulting to
          24 h); Auto Schedule only pulls backlog samples whose length you&apos;ve ticked and leaves the rest in the
          backlog (they aren&apos;t counted as &quot;unplaced&quot;). Each cell it places runs for its <b>own</b> movie
          time, so a run can mix lengths — its overall duration, and how long the instrument stays reserved, follows
          its longest cell. Two placement rules apply: <b>12 h</b> samples can load only on <b>cell 1</b> (the A-column
          carousel position) and <b>30 h</b> samples only on <b>cell 4</b> (the D-column); <b>24 h</b> samples can use
          any cell, taking cells 1 or 4 only when no 12 h/30 h sample needs them. Dragging a sample onto the grid by
          hand is unaffected — it always runs for its own movie time wherever you drop it, and you can still change any
          one cell&apos;s run time afterwards from its slot popover (see <b>Run time</b> under QC actions below).
        </dd>
        <dt>Load time</dt>
        <dd>
          When a newly-created run loads and starts sequencing (there are no pre-loaded runs, so loading and
          sequencing begin together). Click <b>Loads HH:00</b> to open a quick radial dial and pick any hour from{" "}
          <b>08:00 to 20:00</b>. Auto Schedule gives every run it creates this time, and it&apos;s the starting point
          the dial shows when you drag a sample by hand (see below). A cell&apos;s reuse follows automatically — it
          starts once the previous movie finishes and the cells are washed — so a later load time, or a longer movie,
          pushes the reuse&apos;s start later too. If the instrument is already busy when you load, your chosen time is
          still recorded — the app simply tells you when the cells will <em>actually</em> start sequencing once a
          sequencing lane frees up (it never silently moves your time).
        </dd>
        <dt>Optimise for</dt>
        <dd>
          Two strategies. <b>Fastest</b> spreads samples across as many fresh cells as it takes to fill a whole
          tray, so every sample can start as soon as possible — but each of those cells then has its 108-hour expiry
          clock running. Example: 4 samples over 4 days go onto one tray, one per well (A01–D01). <b>Efficient</b>{" "}
          instead reuses one cell up to your <b>Max uses</b> depth before opening the next, keeping fewer cells&apos;
          expiry clocks running at once. Same example: cell 1 runs on Mon, Tue and Wed (its Use 1/2/3), then cell 2
          starts on Thu — so only one cell is &quot;live&quot; at a time.
        </dd>
        <dt>Plates per run (1 plate / 2 plates)</dt>
        <dd>
          How many samples auto-fill schedules per day. <b>1 plate</b> (up to 4 samples) fills a single plate — its
          samples can open a fresh tray <b>or reuse an existing one from either carousel position</b>, the reused
          cells loading into the Plate-1 wells (the sample card shows Plate 1, while the cell&apos;s own tray still
          appears in its physical position on the instrument overview). A cell reused a later day shows up as its
          own <b>separate run</b> that day, reading its next use number, since a 1-plate run never opens a Plate 2
          at all. <b>2 plates</b> (default, up to 8 samples) can load both tray positions in a day, and in this mode
          a reused cell&apos;s <b>next use bundles into the SAME run as its first</b>, as Plate 2 — e.g. cell 1
          loads Monday as Use 1 (Plate 1), then reuses the same day&apos;s
          run as Plate 2 (Use 2), sequencing Tuesday once the instrument gets to it. A third use (or a day where
          Plate 2 is already a genuinely different, fresh second tray loaded that same day) starts its own separate
          run instead, since a run holds at most 2 plates. This only limits what auto-fill proposes; dragging a
          sample onto Plate 2 by hand is unaffected.
        </dd>
        <dt>Reuse this week (skip a tray you plan to dispose)</dt>
        <dd>
          A list of the <b>part-used trays</b> Auto Schedule would otherwise reuse this week — each with a{" "}
          <b>Skip reuse</b> tickbox. Tick a tray when you <b>plan to throw it away</b> rather than run its last
          use(s): Auto Schedule (and Recalculate) then stop offering that whole tray and open <b>fresh cells</b>{" "}
          instead. This is what to use when, say, a weekend run left a cell on its 2nd of 3 uses but you&apos;d
          rather bin the tray than schedule that 3rd use — <b>you no longer have to load a sample and rotate/discard
          a filled tray first</b>. It&apos;s a <b>planning</b> flag, fully <b>reversible</b>: untick it to let the
          tray be reused again — nothing is thrown away and no cell status changes until you actually discard the
          tray on the Cells tab. A skipped tray shows a <b>Reuse skipped</b> badge wherever its cells appear. A
          brand-new, never-used tray isn&apos;t listed here — it&apos;s a fresh cell, not a reuse.
        </dd>
      </dl>
      <RunDesignExample />
      <p>
        <b>The Backlog panel</b> is pinned to the top of the Schedule page, just under the date toolbar, so it stays
        in view as you scroll down the instrument rows — drag a card straight onto any slot and the grid scrolls to
        meet you, no scrolling back up to fetch the next sample. Click the <b>Backlog</b> header to open or collapse
        the tray (your choice is remembered next time); when open, its card list scrolls on its own so it never hides
        the grid beneath it. As you keep scrolling, the grid&apos;s <b>day-header row</b> (the weekday and date for each
        column) catches just under the Backlog and stays pinned there, so you can always tell which day a slot is in;
        the rows slide up and disappear beneath it. To keep the tray as short as possible over the grid, its <b>search box, priority filter,
        sort control, and page controls sit in the Backlog header bar</b> (to the right of <b>✦ Autoschedule</b>) rather
        than above the cards, leaving the body as just the sample list. They work exactly like the same controls on the
        Backlog tab, so you can narrow down to the sample you want before dragging it — see the Backlog tab&apos;s help
        for details on each control.
      </p>
      <p>
        <b>Editing and adding samples from the tray:</b> hover a backlog card (or tab to it) and an <b>✎ edit</b> button
        appears in its top-right corner — click it to open the same sample form the Backlog tab uses, so you can fix a
        sample&apos;s barcodes, priority, or other details without leaving the grid. The last item in the list is always
        a dashed <b>+ Add sample</b> card; click it to add a brand-new sample straight to the backlog with that same
        form. Either way the tray refreshes on save.
      </p>
      <p>
        A backlog card or placed grid slot showing a <b>1/3</b> badge is a <b>duplicate</b> — the same Container ID
        entered more than once so it can be run across multiple cells. Each copy drags onto its own slot
        independently; &ldquo;1/3&rdquo; means copy 1 of 3.
      </p>

      <p className={styles.subheading}>Placing samples</p>
      <ol>
        <li>
          <b>Drag</b> a card from the <b>Backlog</b> panel onto an empty slot. If that slot starts a{" "}
          <b>brand-new run</b> (the first sample on that instrument and day), a radial <b>load-time dial</b> pops up so
          you can set when the run loads and starts sequencing (08:00–20:00) — it opens on your Run design load time;
          click an hour, or press <b>Esc</b> to cancel without scheduling. Dropping onto a day that already has a run
          places straight away at that run&apos;s time. If the instrument is busy with other runs, the sample is still
          placed at your chosen time and a short amber note tells you when its cells will actually start sequencing —
          they queue until one of the machine&apos;s four sequencing lanes frees. Reusing a cell sooner than its own
          wash-and-movie math says it can physically be ready shows a similar heads-up note — the placement still
          stands, it&apos;s just flagged so you can double-check the timing before confirming that run is loaded.
        </li>
        <li>
          <b>Auto-fill:</b> click empty day cells to select them (Shift-click to select a rectangle, Ctrl/Cmd-click
          to toggle individual cells), then press <b>Auto schedule (N selected)</b>. The planner fills those cells
          from the backlog using your Run design settings. Click an instrument&apos;s row header to select every
          open day that week for that instrument, or a day&apos;s column header to select every open instrument on
          that day — handy for scheduling a whole week for one machine, or one day across all machines, in a single
          click. Clicking the same header again clears that selection. <b>Ctrl/Cmd-click</b> a row or column header
          to add it to whatever&apos;s already selected instead of replacing it — build up several days and/or
          several instruments together this way. The <b>Instrument</b> header in the grid&apos;s top-left corner
          selects every open cell across every instrument and day in the current view in one click.
        </li>
      </ol>
      <p>
        <b>Which backlog samples get picked first:</b> when auto-fill has more backlog samples than it has room
        for, it always fills higher-<b>Priority</b> samples first (the same rank shown on the Backlog tab&apos;s
        Priority badge — e.g. High before Standard). Among samples with the same priority, it then works through
        them in <b>External ID</b> order — so a sequential batch (e.g. samples numbered one after another) tends to
        get loaded and run together instead of scattered across different cells or days, which is easier to manage
        at the bench. Only if both priority and External ID are tied does the one that&apos;s been sitting in the
        backlog longest go first, and only after all of that does it consider what packs most efficiently.
      </p>
      <p>
        <b>The slot is a loading position; the cell is chosen for you.</b> A grid slot is where you drop a sample — it
        never &quot;runs out&quot;; only a cell does. When you drag a backlog sample onto a slot, RunNx picks which
        physical SMRT cell it runs on automatically — the same rule the instrument uses: <b>reuse an already-open cell
        before opening a new one</b>, taking the cell nearest its 108-hour deadline first. It looks across the whole
        tray in that position (all four cells, <b>▣1–▣4</b>), not just the well you dropped on: if a used-up cell sits
        in that slot, the drop simply routes to the next usable cell in the tray. Only when no cell in the tray has
        capacity left does a fresh tray of 4 open. The card stays in the slot you dropped on; its <b>stub</b> tells you
        which cell it actually landed on (e.g. <i>▣2</i>). No <i>cell</i> picker ever interrupts the drop — the
        instrument chooses the cell — though the first sample onto a brand-new run day still opens the radial{" "}
        <b>load-time dial</b> (defaulting to your Run design load time) to set when that run loads, as described under{" "}
        <i>Placing samples</i> above.
      </p>
      <p>
        <b>A barcode clash can&apos;t push cells out of tray order.</b> A cell can never run the same barcode twice for
        two <i>different</i> samples, so if a sample&apos;s barcode was already burned on the cell that would naturally
        back its slot by another sample, RunNx skips that cell. Usually it just reaches for the next usable cell — but
        if doing so would leave the plate loading its cells <i>out of tray order</i> (e.g. <i>▣2</i> in an earlier slot
        than <i>▣1</i>, something the instrument never does on a tray whose cells are all at the same use), the drop
        is <b>refused</b> with a note naming the sample whose barcode forced it. Move that sample to a different slot
        or day (or onto a fresh cell) and try again. (Cells legitimately loading out of position because one is
        further through its uses — nearer its 108-hour deadline — is fine and is never blocked.) A <b>duplicate</b>
        sample (same Container ID as an earlier copy) is the one exception: it&apos;s allowed to reuse a cell that
        earlier copy already used, since it&apos;s the same underlying sample either way — see the ↻ badge under{" "}
        <i>Duplicate samples</i> in the Colour &amp; Status Legend.
      </p>
      <p>
        <b>Dropping onto a day the tray has already expired loads a fresh one — automatically.</b> A cell can only be
        reused within its <b>108-hour window</b>. If you drop a sample onto a day that&apos;s past the window of every
        cell in that tray position — so no cell there could still run — RunNx loads a <b>brand-new tray</b> in its
        place, just as the operator would physically swap the aged-out tray for a fresh one. It happens seamlessly,
        with no prompt: the sample lands as <b>Use 1</b> on the new tray, and — since it&apos;s the tray on the
        instrument by the end of the week — the incoming tray takes that position&apos;s slot in the instrument cell
        map (see above) so the swap is visible. The expired tray&apos;s earlier runs that week are untouched.
      </p>
      <p className={styles.subheading}>The holographic cell seal</p>
      <p>
        Each loaded slot shows a small <b>seal</b> on its right edge. Its label is the <b>cell&apos;s</b> own number
        (<i>▣1</i>–<i>▣4</i>, PacBio&apos;s cell 1–4; the <b>▣</b> mark rather than a &quot;C&quot; keeps a cell
        position from being misread as a lettered plate well) with the use number in its own small square next to it (e.g.{" "}
        <i>▣2</i> with a boxed <i>2</i> = cell 2, Use 2) — the cell it&apos;s running on, which can differ from
        the slot it sits in — and its base colour is the Use 1 / 2 / 3 palette (magenta / blue / teal, the same Use
        colours as the legend). The small number along the bottom of the seal is the cell&apos;s <b>tray id</b> — shared by
        every cell in the same physical tray — while the shimmering foil pattern is <b>unique to that one physical SMRT
        cell</b> — so if you see the <i>same</i> foil on two different days, it&apos;s literally
        the same cell being reused; a <i>different</i> foil means a different cell, even when two seals share a label
        like <i>▣2</i>. That&apos;s the quickest read of whether Monday&apos;s <i>▣2</i> and Tuesday&apos;s{" "}
        <i>▣2</i> are the same physical cell. A reused cell keeps one identity across all its uses: the same cell —{" "}
        <i>▣2</i> — reads <i>Use 1</i> on its load day and <i>Use 2</i> on its (separate) reuse day, with the same foil
        both times. <b>Click the
        seal</b> to open that cell&apos;s details — uses so far, 108-hour window, tray position and burned barcodes, with
        links through to its full cell page and to its <b>tray</b> (all four cells of the physical tray, each linking
        back). (Clicking the card&apos;s <i>body</i> still opens the sample/slot detail —
        the seal is specifically the cell.)
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} onOpenCell={() => {}} />
          </div>
          <span>
            <b>Same physical cell, two uses.</b> The two <i>▣2</i> seals below — <i>Use 1</i> and <i>Use 2</i> of one
            cell, on its load day and its reuse day — carry the <i>same</i> foil hue and tray id: one physical cell,
            reused. Click either seal for its cell details.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_PEER} slotIndex={4} onOpenCell={() => {}} />
          </div>
          <span>
            <b>A different cell.</b> Even if another well elsewhere also reads <i>▣2</i>, a different foil hue
            and id tell you at a glance it&apos;s a different physical cell.
          </span>
        </div>
      </div>
      <p>
        <b>Loading a fresh tray into an in-use position.</b> RunNx always prefers to reuse the cells already in a tray
        position before opening a new tray, so you don&apos;t normally choose the cell yourself. When you <i>do</i> want
        to retire a tray early and load a brand-new one into the same position — even though its cells still have
        capacity — use the tray <b>Discard current tray</b> (<b>↻</b>) button (see Locking a run below). It moves
        that day&apos;s samples and any later uses onto fresh cells, restarting at <b>Use 1</b>. There&apos;s no per-drop cell picker:
        the slot is a loading position, and the instrument decides the cell — but the seal popover offers two ways to
        override that choice after the fact, without dragging the sample anywhere:
      </p>
      <p>
        <b>Use a new cell instead</b> (shown only on a reuse well) drops that reuse and re-places the sample fresh at
        the same slot — a separate tray that runs the same day, rather than the next-day reuse the engine picked.{" "}
        <b>Choose a specific cell…</b> opens a searchable list of every open cell on the instrument, so you can force
        an exact one — most usefully to put a run&apos;s Plate 2 onto the <i>exact same</i> physical cells as its
        Plate 1, if the auto-derived choice picked a different one for a well (a barcode clash or a closed 108-hour
        window on the usual cell, for instance). It suggests that plate&apos;s own tray first. Either way, RunNx still
        never lets one plate end up split across two physical trays — an invalid pick is rejected with a clear error
        rather than silently applied.
      </p>
      <p>
        <b>Dragging an already-placed sample to a new slot moves it</b> — to any open slot on any instrument and
        any day, not just the one it&apos;s already on. A sample doesn&apos;t get physically loaded onto anything
        until its run is confirmed loaded; until then it&apos;s just a plan, so moving it anywhere valid never needs
        a confirmation step or a picker. Because a grid slot is a loading <i>position</i> while a physical cell is
        fixed to its own tray position for life, moving a sample to a <i>different</i> slot hands it to whichever
        cell the instrument would reach for there — picked automatically, reuse-before-new — so the card&apos;s stub
        then names <i>that</i> cell, not the one it came from. Moving a sample to the <i>same</i> slot on a different
        day is the exception: that&apos;s a plain reschedule that keeps its own cell. This is what keeps a fresh cell
        in tray order — slot A01 keeps showing cell 1 while cell 1 still has capacity, and you can&apos;t shuffle a
        later cell into an earlier slot ahead of an available one. Dropping a sample back onto the exact slot it came
        from does nothing. Dropping an already-placed sample onto a slot that already holds a <i>different</i> sample{" "}
        <b>swaps the two</b> — they trade places, and a swap preview highlights the target as you hover. Dropping a{" "}
        <i>backlog</i> sample onto an occupied slot, by contrast, does nothing — it never overwrites what&apos;s there.
      </p>
      <p>
        <b>Auto-schedule result</b> summarises the outcome, e.g. &quot;12 placed · 3 unplaced (TRAC-2-26296,
        TRAC-2-26301, TRAC-2-26305) · 1 cell(s) skipped · 2 window flag(s) · 1 reuse-timing flag(s) · 1 barcode
        conflict(s) · 4 cell(s) disposed&quot; — any unplaced samples are named by Container ID (up to the first
        three, then &quot;and N more&quot;) so you know exactly which ones are still sitting in the Backlog, rather
        than just a count. &quot;Cell(s) disposed&quot; is the
        expected result of the Max-uses cap — the cells of any tray whose every cell reached the use limit, binned
        together as one physical tray — reported for transparency, not a warning:
      </p>
      <div className={styles.noteExamples}>
        <Note tone="good" icon="✓">
          Everything placed cleanly.
        </Note>
        <Note tone="warn" icon="!">
          Some samples couldn&apos;t be placed, a cell&apos;s 108-hour window would be at risk, a{" "}
          <b>reuse-timing flag</b> was raised, or a <b>barcode conflict</b> was found (two backlog samples in this
          batch share a barcode — they&apos;re kept off the same cell automatically, but review them before placing
          either). A <b>reuse-timing flag</b> means a scheduled reuse lands earlier than the cell&apos;s own
          wash-and-movie math says it can physically be ready (the instrument needs the prior run&apos;s movie to
          finish, plus a short wash, before it can reload that cell) — a different clock from the 108-hour window.
          This is a heads-up, not a block: the placement still stands, so double-check the day/time before
          confirming that run is loaded.
        </Note>
        <Note tone="bad" icon="!">
          The auto-fill failed.
        </Note>
      </div>

      <p className={styles.subheading}>QC actions</p>
      <p>
        <b>Cell QC</b> — <b>Fail Cell</b>, <b>Fail and Stop Cell</b>, or <b>Retire Cell</b> — lives in one dialog,
        opened <b>two ways without leaving the schedule</b>: click a card&apos;s <b>holographic seal</b> to open the
        cell popover and press <b>QC…</b>, or use the <b>Cell QC</b> button in a filled slot&apos;s detail popover.
        (Clicking a cell in the left-hand <b>instrument cell map</b> instead opens that cell&apos;s <b>detail page</b>,
        where the same QC actions live.) Fail / Fail-and-Stop become available once that run is locked in (<b>Confirm
        loaded</b> clicked); Retire works on any open cell (the Cells tab&apos;s help has the full definitions). Each
        takes an optional reason note.
      </p>
      <p>
        Because loading is a continuous queue, stopping or retiring a cell shifts its later samples onto the
        tray&apos;s remaining cells and the tail may drop off. The dialog then asks you to decide each affected sample
        — <b>Lost</b> (→ the Backlog&apos;s <b>Top-up required</b> list), or <b>Repeatable</b> / <b>Recoverable</b>{" "}
        (→ the Backlog&apos;s <b>Recoverable Samples</b> section, above High priority). Samples that simply ran on a
        <i>different</i> cell than planned are flagged for review — with a warning if the shift created a barcode
        clash. A stopped/retired cell is never offered for reuse again; the same dialog later offers <b>Undo QC</b> to
        reverse the whole action (a top-up whose request was already sent is left in place). Cancelled uses stay
        visible as <b>Blocked</b> slots (see below) rather than disappearing.
      </p>
      <p>
        <b>Opening a placement:</b> clicking a filled slot&apos;s <b>card body</b> opens its detail popover, now titled
        by the <b>sample</b> (its Container ID), with the cell it ran on shown just beneath — so it reads clearly apart
        from the cell-stub popover (which stays titled by the physical cell). The <b>Sample ID</b> is a link to that
        sample&apos;s own page, and the <b>Run</b> value links to that run&apos;s page.
      </p>
      <p>
        <b>Stepping through the run&apos;s cells:</b> when a run has more than one cell, the popover title shows{" "}
        <b>‹ ›</b> arrows either side of the sample ID — use them to move to the previous / next cell of the same run
        without closing the popover and hunting for its card on the grid. The line beneath the title shows which cell
        you&apos;re on (e.g. <i>cell 2 of 4 in this run</i>). You can also jump straight to any cell by clicking its{" "}
        <b>sample ID in the estimated-stage-times gantt</b> lower down — the row you&apos;re already viewing stays
        highlighted and isn&apos;t a link.
      </p>
      <p>
        <b>Editing the sample:</b> next to the Sample ID a small <b>✎</b> button opens the quick edit form for that
        sample&apos;s loading parameters (<b>Target OPLC</b>, <b>Actual OPLC</b>, the complex-loading volumes{" "}
        <b>Cleaned Complex</b> and <b>Loading Buffer</b> that pre-fill the batch
        sheet&apos;s dilution worksheet, <b>Adaptive Loading</b>, <b>Full-Resolution Base Q</b>, <b>Priority</b> and{" "}
        <b>Include Base Kinetics</b>) without going back to the Backlog. Once a sample is placed on the grid its{" "}
        <b>barcodes</b>, Sanger IDs and parent are locked —
        they&apos;re already burned onto the cell — so only those loading settings can change here. The ✎ is hidden
        once the sample&apos;s use is locked (completed, failed, or a cancelled &quot;Blocked&quot; slot), since its
        record is then history. To fix a placement&apos;s <b>note</b>, use the <b>Notes</b> box lower in the same
        popover.
      </p>
      <p>
        <b>Estimated stage times:</b> the popover also shows a small gantt of the whole run&apos;s wells, each broken
        into its three stages in sequence — a slate <b>prep</b> lead-in, the sequencing <b>movie</b> (coloured by the
        cell&apos;s use: magenta 1 / blue 2 / teal 3), then a darker slate <b>PPA</b> (post-primary analysis) tail —
        staggered across the run, with <i>this</i> placement&apos;s row highlighted, so you can see where your sample
        sits in the run&apos;s flow. Because the instrument can only run <b>two cells&apos; PPA at once</b>, a cell
        whose movie finishes while both PPA lanes are busy shows a short <b>hatched &quot;waiting for PPA&quot;</b> gap
        before its PPA starts — so the 3rd and 4th cells of a tray finish a little later. The axis along the bottom is
        marked in <b>clock time</b> (e.g. 12:00, 18:00), and if the run is happening <i>right now</i> a green{" "}
        <b>live line</b> — topped with a spinning marker — sweeps down through every bar to show where the run has got
        to. These are approximate PacBio timings anchored at the run&apos;s load time, an estimate rather than the
        instrument&apos;s exact schedule.
      </p>
      <p>
        <b>Run time:</b> the popover shows this cell&apos;s own movie / run time, and while the run is still planned
        (not yet <b>Confirm loaded</b>) you can change it right there with the <b>12 h / 24 h / 30 h</b> buttons — the
        change saves as soon as you pick a value. Each cell in a run carries its own run time, so this only affects the
        cell you clicked; the run&apos;s overall length and how long its instrument stays reserved follow its longest
        cell, so those may update after you change one. Once the run is locked, the run time is shown read-only (it
        records what the instrument actually ran).
      </p>
      <p>
        <b>Sample notes:</b> the same popover has a <b>Notes</b> box for a free-text note about this sample on this
        cell — anything worth flagging to whoever loads it (a handling reminder, a query, a re-run reason). Type a
        note and click <b>Save note</b>; it stays visible whenever you reopen that slot and remains editable at any
        time, including after the run is locked (unlike the placement itself, which locks once loaded). The note also
        prints in the <b>Notes</b> column of the Batch Sheet for that well. It is tied to this one placement, so a
        sample reused on another cell starts with a blank note there. Clearing the box and saving removes the note.
      </p>
      <p>
        <b>Undoing a QC mistake:</b> re-open the Cell QC dialog on a stopped or retired cell — from its seal or the
        slot popover&apos;s <b>Cell QC</b> on the schedule, or on the cell&apos;s detail page (which the instrument
        cell map opens) — and choose <b>Undo QC</b>. It reopens the
        cell and restores every sample the action affected — reassigned samples move back, cancelled ones become
        planned again, and backlog/top-up moves are reversed — except a sample that has since moved on, or a top-up
        whose request was already marked sent, which are left as they are.
      </p>
      <p>
        <b>Failed/Aborted/Stopped/Blocked indicator</b> on the grid flags a QC problem without opening the slot,
        following a severity scale, mildest to most severe:
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_ABORTED} slotIndex={0} />
          </div>
          <span>
            <b>Aborted</b> (amber/yellow) — the whole run was aborted (an instrument/run problem, not this cell);
            its sample is already back in the Backlog.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_FAILED} slotIndex={0} />
          </div>
          <span>
            <b>Failed</b> (orange) — that specific use produced no usable data, whether from <b>Mark Failed</b> or
            as the use a <b>Stop cell</b> was triggered from; the cell may still be fine for its other, earlier
            uses.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_STOPPED} slotIndex={0} />
          </div>
          <span>
            <b>Stopped</b> (red) — the physical cell itself has been taken out of service for good.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_CANCELLED} slotIndex={0} />
          </div>
          <span>
            <b>Blocked</b> (red, cross-hatched) — a placement cancelled before it ever ran; its sample is back in the
            Backlog. From a <b>Stop cell</b> it&apos;s a permanent, read-only marker (no drag, no Remove); from a
            <b> cell discard</b> you can clear it by opening the slot and clicking <b>Return to backlog</b>.
          </span>
        </div>
      </div>
      <p>
        A use that already ran, failed, or was cancelled by a stop keeps showing that true, specific history —{" "}
        <b>Stopped</b> is only ever a fallback, for the rare case where a whole-cell Stop wasn&apos;t anchored to
        any one use (from the Cell detail page, with no single use in progress) and left one of this cell&apos;s
        uses with no outcome of its own recorded.
      </p>
      <p>
        <b>A cell&apos;s tray/well position never changes.</b> The weekly grid shows the fixed physical positions of
        trays and cells across instruments and days — a tray is a real object sitting in one instrument bay, so
        there&apos;s no action anywhere that swaps which physical cell occupies an already-loaded slot. What you&apos;re
        actually doing when you schedule is assigning a <i>sample</i> to a specific, already-existing cell use.
        Dragging a placed sample to a different slot reassigns the sample — it lands on whichever cell already lives
        there (see above) — it never moves or replaces a cell.
      </p>

      <p className={styles.subheading}>Removing placements</p>
      <ul>
        <li>
          <b>Ctrl/Cmd-click</b> a filled slot to toggle it into a selection (a &quot;N sample(s) selected&quot; bar
          appears above the grid); ctrl/cmd-click again, or the bar&apos;s <b>Clear</b> button, to deselect.
          <b> Ctrl/Cmd-click and drag</b> across several samples to draw a selection rectangle over all of them in
          one motion — the easiest way to grab a whole block spanning several instruments and days at once. Without
          dragging, ctrl/cmd-click one sample, then <b>Ctrl/Cmd+Shift-click</b> another to select the rectangle
          between the two instead. Either way, locked (confirmed-loaded) and already-cancelled slots inside that
          rectangle are skipped automatically.
        </li>
        <li>
          With samples selected, press <b>Remove from schedule (Del)</b> — the Delete/Backspace key does the same, as
          long as you&apos;re not typing in a text box — to remove just those samples and return them to the
          backlog, leaving everything else on the grid untouched.
        </li>
        <li>
          <b>Clear schedule (N planned)</b> wipes every <i>planned</i> placement in the current week view and
          returns those samples to the backlog. A confirmation dialog first states exactly how many samples will be
          removed and warns it can&apos;t be undone. Confirmed/loaded runs are never touched, so the number cleared
          can be lower than the total on screen.
        </li>
        <li>
          <b>Drag a placed sample off the grid</b> (drop it anywhere that isn&apos;t a slot) to remove it from the
          schedule the same way — while you&apos;re holding it, the slot it came from shows its empty <b>+</b>{" "}
          placeholder as a preview of that removal.
        </li>
      </ul>

      <p className={styles.subheading}>Locking a run</p>
      <ul>
        <li>
          <b>Confirm loaded</b> appears once a run has at least one sample; press it when the cells are physically
          loaded on the instrument. There is <b>one Confirm loaded per run</b> — it locks the <i>whole</i> run,{" "}
          <b>both plates</b> at once (a reuse run&apos;s Plate 2 is loaded in the same session, so it locks with
          Plate 1), marking it running/LOADED so it can no longer be edited by accident. A small dialog lets you
          give the run a name (e.g. your lab&apos;s own run id, such as Sanger&apos;s <b>TRACTION-RUN-1234</b>{" "}
          format) — optional, and it overrides the plain run number everywhere this run is shown afterward (Run
          detail, History, Cells use history). Leave it blank to keep the plain number. <b>Unloading</b> never clears a
          name once it&apos;s set; re-confirming lets you change it. The same dialog also lets you <b>amend the load
          time</b> — the <b>Revio Loaded at:</b> field prefills with the planned time; if the cells actually went on the
          instrument at a different time, type the real one as <b>hh:mm</b> and the run&apos;s schedule (and any reuse
          plate chained off it) shifts to match.
        </li>
        <li>
          A green <b>LOADED</b> tag marks a locked run — hover or focus it and it turns magenta and swaps to{" "}
          <b>UNLOAD</b>; click it to return the run to planned so you can edit it again.
        </li>
        <li>
          The <b>↻</b> button in a tray&apos;s top-right corner is <b>Discard current tray</b> — use it when you
          physically swap that tray for a fresh one (its cells are used up, expired, or you just want a clean tray from
          this day on). It discards the current tray after this plate loads and moves <b>this day&apos;s samples, plus
          any later uses of the tray</b>, onto a new tray&apos;s cells — each restarting at <b>Use 1</b> in the same
          well. The confirmation lists the tray&apos;s current cells and how many uses each has left, with a link to
          each cell&apos;s detail page. Uses on{" "}
          <i>earlier</i> days stay exactly where they are on the old cells, which are then discarded (Exhausted).
          So a sample that was, say, this cell&apos;s Use 3 becomes Use 1 on the fresh tray, and the days before it
          are untouched. It can&apos;t be undone, and isn&apos;t available on a run that&apos;s already{" "}
          <b>Confirm loaded</b> (unlock it first) — the cells are physically in the instrument by then.
        </li>
        <li>
          A teal <b>🔒 padlock</b> chip appears next to the status on every day the instrument is reserved by a run —
          its own load day and any later day still held by its lock. Hover or focus it and it expands to reveal the
          exact date/time the instrument frees up. The day the reservation actually <i>ends</i> stays open to load —
          the instrument frees up partway through it, so you can still schedule a run there and it simply starts
          when the instrument is free (its start time shifts to the clear time). Only days the lock covers
          end-to-end show the padlock with no droppable slots.
        </li>
      </ul>

      <p className={styles.subheading}>Runs, plates &amp; wells</p>
      <p>
        A grid cell is a <b>run</b> — one physical load session on one instrument on that day. Each run shows{" "}
        <b>Plate 1</b> and <b>Plate 2</b>, two loading positions of four wells each, drawn as their own bordered
        cards. A run holds <b>1 or 2 plates</b>, and both plates are loaded in the one session:
      </p>
      <ul>
        <li>
          A <b>single-plate run</b> fills only Plate 1 (Plate 2 stays empty).
        </li>
        <li>
          A <b>parallel two-plate run</b> loads a second, different tray into Plate 2 — both plates sequence the{" "}
          <i>same</i> day (both Use 1, on different cells).
        </li>
        <li>
          A <b>reuse run</b> reruns Plate 1&apos;s cells as Plate 2 on a <i>later</i> weekday (Use 2, after the
          instrument&apos;s on-board wash). Plate 2&apos;s header shows the day it acquires right next to its title —
          there&apos;s no separate &quot;reuse&quot; label because the cell stub already goes from <b>Use 1</b> to{" "}
          <b>Use 2</b>, which says the same thing — and the whole thing is still one run you loaded once — you don&apos;t reload anything for
          Plate 2. This is what a hand drop that reuses a cell already loaded in that day&apos;s run produces, and
          — in <b>2 plates per run</b> mode — what Auto Schedule and Recalculate now produce too, whenever reusing
          a cell means fewer physical trays overall: the grid shows one run you loaded once, and the cell stub
          (Use 1 / Use 2) tells you what the machine is actually doing with it. In <b>1 plate per run</b> mode a
          reused cell always becomes its own separate run on the reuse day instead, since a 1-plate run never opens
          a Plate 2 to bundle into.
        </li>
      </ul>
      <p>
        Because a reuse Plate 2 sequences on a <i>different</i> day from the load day, that later day&apos;s column
        shows a lightweight <b>&quot;Plate 2 loads [run name] @ [time]&quot;</b> marker and is greyed out and
        non-droppable — <b>there&apos;s no action to take there</b>; the instrument runs Plate 2 itself. Manage the
        run (edit it, Confirm loaded, print its sheet) from its own load-day column, not the continuation day. Every
        such day also carries the same <b>🔒 padlock</b> as a plain lock carry-over (see Locking a run below) —
        hover it for the release time. A long movie whose instrument stays reserved into a later day with no plate
        of its own acquiring shows just the padlock, with no other marker.
      </p>
      <p>
        <b>Each grid slot is a plate loading position</b> — where you drop a sample, not a fixed cell. An empty slot
        shows a cross-hatched placeholder <b>labelled with its plate-well position</b> — e.g. <b>+ A01</b> (column 1 of
        the 96-well plate; the <b>Plate 1</b>/<b>Plate 2</b> header above says which plate) — and <b>a slot never
        &quot;runs out&quot;</b>: even when the cell that last ran there is used up, the slot stays droppable.{" "}
        <b>Dropping a sample onto it assigns a cell for you</b> — reusing whichever cell in that tray position is next in line (the one nearest its
        108-hour deadline), across all four of the tray&apos;s cells, and only opening a fresh tray of 4 once none has
        capacity left. You see which cell you got — and its use number — from the holographic seal on the loaded card
        afterward (see &quot;The holographic cell seal&quot; above). The Use 1 / Use 2 / Use 3 colours (magenta / blue /
        teal) show which use of a cell each barcode chip belongs to — see the Colour &amp; Status Legend section.
      </p>
      <p>
        The grid&apos;s <b>&quot;Plate 1&quot;/&quot;Plate 2&quot;</b> are <i>loading positions</i> within a run — a
        different thing entirely from a physical SPRQ-Nx SMRT Cell tray of 4 cells (see the Cells tab&apos;s help).
        A cell&apos;s position within its own physical tray is shown on its seal, the Cells page and Cell Detail.
      </p>

      <p className={styles.subheading}>Reusing a resident cell</p>
      <p>
        A tray that&apos;s still loaded but idle — its cells used once or twice, with uses left — simply reads as plain{" "}
        <b>+</b> placeholders, like any other empty slot. Dropping a sample onto one lands on the next-in-line cell in
        that tray automatically (its next Use) — RunNx reuses before opening a new tray, and you confirm which cell you
        got from its seal once it&apos;s loaded. Because the slot is a loading position, dropping onto the slot where a
        <i>used-up</i> cell sat just routes to a sibling that still has capacity — so a spent cell never blocks you. To
        load a <i>brand-new</i> tray into that position instead of reusing, use the tray <b>Discard current tray</b>{" "}
        (<b>↻</b>) button.
      </p>
      <p>
        You don&apos;t have to hunt for the reuse deadline: the <b>tray overview</b> beneath each instrument&apos;s
        number (left column) shows each cell&apos;s own <b>108-hour deadline</b> — colour-coded green/amber/red with a
        countdown, projected to the end of the week (hover for the status right now) — so the cells worth reusing soon
        (amber) and those already gone (red) stand out at a glance. Each cell&apos;s own detail page shows its exact
        108-hour reuse window.
      </p>

      <p className={styles.subheading}>Slot shading &amp; cell-link highlight</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE} slotIndex={0} />
          </div>
          <span>
            <b>Slot shading:</b> a filled slot fades from full colour toward a paler tint the closer that cell gets
            to its own 108-hour deadline. Always that one cell&apos;s own clock; cells sharing a physical tray
            don&apos;t share a deadline, so two slots from the same tray can shade differently.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_SOURCE} slotIndex={0} linkSource />
          </div>
          <span>
            <b>Cell-link highlight:</b> resting the pointer on a loaded slot for about a second and a half
            highlights every other slot elsewhere in the schedule holding the <i>same physical cell</i> — a solid
            ring around the slot you&apos;re hovering or have pinned.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_PEER} slotIndex={4} linked />
          </div>
          <span>Another use of that same physical cell, wherever it lands on the calendar — a dashed ring.</span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_UNRELATED} slotIndex={1} dimmed />
          </div>
          <span>An unrelated cell, softened so the linked slots stand out.</span>
        </div>
      </div>
      <p>
        <b>Shift-click</b> a slot (or press <b>Shift+Enter</b> while it&apos;s focused) to pin the highlight
        immediately, with no wait, so it stays put while you move the mouse elsewhere; press <b>Escape</b> or click
        anywhere outside a loaded slot to clear it. Moving on before the hover delay cancels it, so just scanning
        across the grid doesn&apos;t flash highlights, and the highlight is suspended while dragging a sample.
      </p>

      <p className={styles.subheading}>Blocked wells</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} blocked />
          </div>
          <span>
            <b>Blocked:</b> once a physical cell is stopped (a QC action), its well is retired for the rest of that
            tray&apos;s time on the instrument — a greyed <b>✕</b>, and no new cell can be loaded into that exact
            slot. The block lifts only once that physical tray leaves and a brand-new tray is loaded into the same
            bay on a later day, since that later tray&apos;s cell is a different physical object.
          </span>
        </div>
        <div className={styles.legendRow}>
          <span>
            A <b>used-up cell no longer blocks its slot</b>. A grid slot is a plate <em>loading position</em>, not a
            cell: when a cell is exhausted, expired, or retired, its slot stays a normal droppable <b>+</b>. Loading a
            sample there lands it on the next usable cell in that tray automatically — the card&apos;s stub shows which
            cell it actually ran on. Watch the tray overview (left column) for when a used cell&apos;s 108-hour window
            is about to close with uses still left on it — its <b>exp</b> date turns amber.
          </span>
        </div>
      </div>
    </div>
  );
}

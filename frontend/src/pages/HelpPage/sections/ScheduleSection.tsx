import { useState } from "react";

import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { Note } from "@/components/ui/Note";
import { RunDesignAccordion } from "@/pages/SchedulePage/RunDesignAccordion";
import type { RunDesignState } from "@/types/schedulerGrid";

import styles from "../HelpPage.module.css";
import {
  GHOST_EXAMPLE_CUTOFF,
  GHOST_EXAMPLE_EXHAUSTED,
  GHOST_EXAMPLE_FADING,
  GHOST_EXAMPLE_SCHEDULED,
  GHOST_EXAMPLE_UNUSED,
  STAGE_EXAMPLE_ABORTED,
  STAGE_EXAMPLE_CANCELLED,
  STAGE_EXAMPLE_FAILED,
  STAGE_EXAMPLE_PEER,
  STAGE_EXAMPLE_SOURCE,
  STAGE_EXAMPLE_STOPPED,
  STAGE_EXAMPLE_UNRELATED,
  STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE,
} from "./helpFixtures";

/** A real, live RunDesignAccordion - same component the Schedule page itself renders -
 * wired to local state instead of the actual auto-fill/clear mutations, purely for
 * illustration (see CLAUDE.md's Help Tab Maintenance section). */
function RunDesignExample() {
  const [runDesign, setRunDesign] = useState<RunDesignState>({
    max_uses: 3,
    run_time_hours: 24,
    objective: "fewest",
    cells_per_day: 8,
  });
  return (
    <RunDesignAccordion
      runDesign={runDesign}
      onChange={setRunDesign}
      selectedCount={3}
      onAutoSchedule={() => {}}
      autoFilling={false}
      weekPlannedCount={5}
      onRequestClearSchedule={() => {}}
      note={null}
    />
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
        <b>‹ Prev</b> and <b>Next ›</b> page the view by 7 days; <b>Today</b> jumps back to the current window. The
        date range is shown between them, and it&apos;s remembered in the page URL so you can bookmark or share a
        week. The date field next to <b>Today</b> is a jump-to-date picker — pick any day and the view jumps
        straight to the Mon-Fri week that contains it, without paging through every week in between.
      </p>
      <p>
        <b>Weekends aren&apos;t shown</b> — the grid only has Monday-Friday columns, because runs aren&apos;t
        started at weekends.
      </p>

      <p className={styles.subheading}>Print Batch Sheet</p>
      <p>
        <b>Print Batch Sheet</b> opens a printable loading sheet for the Revios. Pick a day and tick which
        instruments to include — handy when different people load different machines, since each person can print
        just their own. The sheet opens in a new tab with every well&apos;s cell code, use number and 108-hour
        reuse deadline, the sample to load and its barcode(s)/container, and the run settings (adaptive loading,
        CCS kinetics, full-resolution baseQ, OPLC, volume) — everything needed to find the right samples, load them
        in the right wells, and set up the run. Use the page&apos;s <b>Print / Save as PDF</b> button, which opens
        your browser&apos;s normal print dialog (choose a physical printer, or &quot;Save as PDF&quot;).
      </p>

      <p className={styles.subheading}>Run design &amp; auto-fill</p>
      <p>
        <b>Run design</b> (collapsible panel, shown live below) sets the parameters used for both single placements
        and auto-fill:
      </p>
      <dl className={styles.terms}>
        <dt>Max uses per cell (1× / 2× / 3×)</dt>
        <dd>
          How many times auto-fill will try to reuse each SMRT cell before opening a new one. This is always
          honored in full — it&apos;s only reduced automatically if you select fewer days than the chosen use
          count, since a cell can&apos;t be reused twice on the same day. A cell physically supports up to 3
          acquisitions.
        </dd>
        <dt>Movie / run time (12 h / 24 h / 30 h)</dt>
        <dd>The sequencing movie length applied to runs you create.</dd>
        <dt>Optimise for</dt>
        <dd>
          <b>Fewest cells</b> and <b>Balance</b> both reuse cells as deep as your Max uses setting allows;{" "}
          <b>Fastest</b> instead spreads new samples across more cells so more of them can start sooner, at the
          cost of using more cells. <b>Utilisation</b> goes further still: it opens enough distinct cells to fill a
          whole instrument-day&apos;s wells (matching your Cells per day setting) before reusing any of them for a
          2nd/3rd use — fewer half-loaded runs, at the cost of using more cells.
        </dd>
        <dt>Cells per day (4 / 8)</dt>
        <dd>
          How many of a run&apos;s 8 wells auto-fill is allowed to use per instrument/day. <b>8</b> (default) can
          fill both trays; <b>4</b> restricts auto-fill to tray 1 only, so it never proposes loading tray 2 that
          day — useful if only one tray&apos;s worth of loading capacity is available. This only limits what
          auto-fill proposes; dragging a sample onto tray 2 by hand is unaffected.
        </dd>
      </dl>
      <RunDesignExample />
      <p>
        <b>The Backlog panel</b> (collapsible, above the grid) has the same search box, priority dropdown, sort
        control, and rows-per-page control as the Backlog tab, so you can narrow down to the sample you want before
        dragging it — see the Backlog tab&apos;s help for details on each control.
      </p>

      <p className={styles.subheading}>Placing samples</p>
      <ol>
        <li>
          <b>Drag</b> a card from the <b>Backlog</b> panel onto an empty slot.
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
        <b>The placement picker</b> appears after a drop only when there&apos;s an actual decision to make. When you
        drop a backlog sample onto an empty slot with more than one compatible open cell on that instrument, it
        offers <b>Use a new cell</b> (default) or any of those compatible cells. A cell is offered only if it still
        has a use left <i>and</i> none of its already-used (&quot;burned&quot;) barcodes clash with your
        sample&apos;s barcodes — running the same barcode twice on one cell isn&apos;t allowed, and there is no way
        to override this. If there&apos;s no real choice — you dropped directly onto a waiting-cell ghost, or there
        are no reusable cells at all on that instrument — the picker skips itself entirely and proceeds
        automatically with a default <b>12:00 loading start time</b>, even if this is the first placement on that
        instrument/day. The picker only still stops to ask when your drop <i>would</i> start a brand-new run{" "}
        <i>and</i> there&apos;s a genuine cell choice to make (more than one compatible cell, with no ghost telling
        it which one you meant) — in that case it shows both the <b>Loading start time</b> field and the cell
        choice together. When compatible cells are offered, they&apos;re grouped by which physical SPRQ-Nx SMRT Cell
        tray they came from, in cell-number order, so you can see a tray&apos;s other cells together. Picking{" "}
        <b>Use a new cell</b> opens a whole new physical tray of 4 at once — the other 3 appear immediately as open,
        reusable cells (in the Cells page, future pickers, and the grid itself — see &quot;Slots and trays&quot;
        below), even though only one of them has a sample on it yet.
      </p>
      <p>
        If you drop directly onto a waiting-cell ghost whose burned barcodes clash with your sample&apos;s, the
        picker doesn&apos;t quietly substitute a new cell instead — it opens with a clear warning naming the exact
        barcode and cell involved, so you can see why that cell was rejected before choosing a different one.
      </p>
      <p>
        <b>Dragging an already-placed sample to a new slot moves it</b> — to any open slot on any instrument and
        any day, not just the one it&apos;s already on. A sample doesn&apos;t get physically loaded onto anything
        until its run is actually confirmed loaded; until then it&apos;s just a plan, so moving it anywhere valid
        never needs a confirmation step. A physical cell can never change wells or instruments, though, so the{" "}
        <i>destination</i> decides which cell the sample lands on, not the sample&apos;s own prior cell: dropping
        onto the exact well the cell already occupies keeps it there (a plain reschedule to a different day), while
        dropping onto any other well or a different instrument entirely — even one on the very same tray, even the
        same day — hands the sample to whichever cell actually lives there instead (a new one, or another
        compatible reusable cell), using the exact same placement picker and auto-resolve rules described above. The
        cell it came from is untouched by this — it keeps its own other uses, if it has any, right where they are.
        A move that starts a brand-new run and has no cell decision to make always shows the picker anyway, since
        that&apos;s the one case it has no other way to collect a loading start time. Dropping a sample back onto
        the exact slot it came from does nothing. Dropping it onto a slot that already has a <i>different</i>
        sample in it is rejected — it never swaps the two samples or overwrites what&apos;s there.
      </p>
      <p>
        <b>Auto-schedule result</b> summarises the outcome, e.g. &quot;12 placed · 3 unplaced · 1 cell(s) skipped ·
        2 window flag(s) · 1 barcode conflict(s)&quot;:
      </p>
      <div className={styles.noteExamples}>
        <Note tone="good" icon="✓">
          Everything placed cleanly.
        </Note>
        <Note tone="warn" icon="!">
          Some samples couldn&apos;t be placed, a cell&apos;s 108-hour window would be at risk, or a{" "}
          <b>barcode conflict</b> was found (two backlog samples in this batch share a barcode — they&apos;re kept
          off the same cell automatically, but review them before placing either).
        </Note>
        <Note tone="bad" icon="!">
          The auto-fill failed.
        </Note>
      </div>

      <p className={styles.subheading}>QC actions</p>
      <p>
        <b>From the grid:</b> click a filled slot to open its detail. The Sample, Well, Run and Cell uses are shown
        first — plus the cell&apos;s 108-hour window meter once its clock has started — and its QC quick actions sit
        in the top-right corner of the popover, next to the cell code: <b>Mark Failed</b> or <b>Stop cell</b> — the
        same two actions available on the Cell detail page, without leaving the schedule. Both are shown in red,
        since each takes the use or the physical cell out of service, and both only appear once that run is locked
        in (<b>Confirm loaded</b> clicked) — they always appear and disappear together (see the Cells tab&apos;s
        help for exactly when). Each shows a short reason/notes box and a confirm step in the same popover before
        applying. <b>Mark Failed</b> only affects this one use — no usable data was produced, and the cell stays
        open for its other uses. <b>Stop cell</b> does more: this use&apos;s sample counts as Failed too (no data,
        needs a PacBio credit case), <i>and</i> the physical cell is taken out of service — every one of its later,
        not-yet-run uses elsewhere on the grid is cancelled, their samples returned to the Backlog flagged{" "}
        <b>Aborted</b> (see the Backlog tab&apos;s help) so a scheduler can rescue them onto a different cell. Uses
        that already ran on this cell before the stop are left completely untouched. Every cancelled use stays
        visible as a <b>Blocked</b> slot (see below) rather than disappearing, so a day&apos;s plan never silently
        loses a placement without a trace.
      </p>
      <p>
        <b>Undoing a QC mistake:</b> flagged the wrong slot? An <b>Undo Failed</b> button replaces{" "}
        <b>Mark Failed</b> once a verdict has been recorded, and an <b>Undo stop</b> button appears once a cell is
        stopped — shown in the same neutral style as the rest of the popover&apos;s buttons, not red, since undoing
        isn&apos;t itself a destructive action. Each restores the placement (or every use a Stop cell touched, for{" "}
        <b>Undo stop</b>) to how it looked beforehand. The <b>Undo Failed</b> button disappears again if the sample
        involved has since been requeued or rescheduled elsewhere, since undoing at that point would double-book
        that sample — reschedule from the Backlog instead in that case.
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
            <b>Blocked</b> (red, cross-hatched) — a placement cancelled by a <b>Stop cell</b> action before it ever
            ran; its sample is back in the Backlog flagged <b>Aborted</b>, ready to be rescued onto a different
            cell. A permanent, read-only marker (no drag, no Remove).
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
          <b>Confirm loaded</b> appears once a day has at least one sample; press it when the cells are physically
          loaded on the instrument. This locks the run (marks it running/LOADED) so it can no longer be edited by
          accident. A small dialog lets you give the run a name (e.g. your lab&apos;s own run id, such as
          Sanger&apos;s <b>TRACTION-RUN-1234</b> format) — optional, and it overrides the plain run number
          everywhere this run is shown afterward (Run detail, History, Cells use history). Leave it blank to keep
          the plain number. <b>Unlock</b> never clears a name once it&apos;s set; re-confirming lets you change it.
        </li>
        <li>
          A <b>LOADED</b> tag marks a locked run; <b>Unlock</b> returns it to planned so you can edit it again.
        </li>
        <li>
          An amber <b>&quot;⚠ Tray N · #… — … will be disposed unused&quot;</b> note next to Confirm loaded means
          this day is the <b>last chance to reuse</b> a physical tray that still has cells with uses left over.
          That last-chance day is the last day the tray is still on the instrument with usable capacity, set by
          whichever comes first: the day its cells reach their reuse deadline (&quot;expires today&quot;), or the day
          before a <b>new tray</b> needs that carousel position — in which case the note adds{" "}
          <b>&quot;(new tray loads next)&quot;</b> to flag that you must dispose the old tray to make room. Once
          that day passes the tray is disposed and any spare capacity is lost. It names the tray (its position and
          id) and the specific cells being wasted (hover for the full list) — so you can decide whether to reuse
          those cells before then, or accept the waste.
        </li>
        <li>
          The <b>✕</b> button in a tray&apos;s top-right corner is <b>Discard Cells</b> — it force-marks every
          physical cell in that tray as Exhausted, regardless of how many uses it actually has left. Use it once a
          tray is done with in real life even though the system still thinks it has spare uses. Any not-yet-run
          placements for those cells are cancelled and their samples return to the backlog. This cannot be undone.
          Since it exhausts every cell in the tray at once, the whole tray disappears from the schedule immediately
          afterwards and its wells open up for a brand-new one (see &quot;Used-up wells&quot; below).
        </li>
        <li>
          <b>Locked until [date/time]</b> means the run&apos;s instrument stays reserved past this day (a long
          movie), so later days show a &quot;Locked until…&quot; note even though no run starts on them.
        </li>
      </ul>

      <p className={styles.subheading}>Slots and trays</p>
      <p>
        Each day cell always shows both trays of four slots, each drawn as its own bordered card so a tray&apos;s
        four cells read as one physical object — they always stay together, whether empty or loaded. An empty well
        shows the plain <b>+</b> cross-hatched placeholder. The moment any one cell in a tray gets a sample, its
        other cells switch from that plain placeholder to their own reserved <b>CELL-A00XXXX</b> ID — not just the
        well(s) actually in use — and this keeps showing on every later day until each one is loaded or discarded
        (see &quot;Waiting cells &amp; reuse ghosts&quot; below for what an unused one looks like). The Use 1 / Use 2
        / Use 3 colours
        (magenta / blue / teal) show which use of a cell each barcode chip belongs to — see the Colour &amp; Status
        Legend section. A physical cell also always stays in the exact same tray/well position for every one of
        its reuses, never just any open slot — so once a cell has a well of its own, the placement picker only
        offers it for a drop into that same well, and its waiting-cell ghost only ever appears there. There is
        deliberately no way to start a brand-new cell in a slot that already belongs to
        another cell&apos;s reuse; a cell&apos;s first use can start in any open slot, but from then on it&apos;s
        pinned. This grid layout&apos;s own &quot;Tray 1&quot;/&quot;Tray 2&quot; loading positions are a different
        thing entirely from a physical SPRQ-Nx SMRT Cell tray of 4 cells (see the Cells tab&apos;s help) — a
        cell&apos;s position within its own physical tray is shown on the Cells page and Cell Detail, not on this
        grid.
      </p>

      <p className={styles.subheading}>Waiting cells &amp; reuse ghosts</p>
      <p>
        Once a multi-use cell&apos;s last placed use passes, an empty slot on the <i>earliest day it could next be
        loaded</i> — on the same instrument, one weekday after that last use — shows a tinted placeholder instead
        of the plain <b>+</b>, coloured the same as a real Use 2/3 chip and labelled with the exact day its
        108-hour window closes:
      </p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_FADING} />
          </div>
          <span>
            Waiting to be reused — fades from full colour toward a paler tint as the expiry date nears. If Use 1
            hasn&apos;t been confirmed loaded yet, the expiry shown is an estimate from its planned loading time
            rather than the real 108-hour clock, which only starts once the cell is actually removed from the tray.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_CUTOFF} />
          </div>
          <span>
            Last day this cell can still start its next use — a fixed amber &quot;expires today&quot; look instead
            of continuing to fade, so the final opportunity never reads as &quot;about to vanish&quot;.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_UNUSED} />
          </div>
          <span>
            <b>Never-yet-used tray cell</b> — a physical tray&apos;s cell that hasn&apos;t been loaded at all yet:
            muted grey, static, dotted-border, &quot;Not yet used&quot; label, no expiry countdown since its
            108-hour clock hasn&apos;t started (deliberately not coloured by use number, so it never looks like an
            already-loaded Use 1).
          </span>
        </div>
      </div>
      <p>
        It always shows up in the exact well the cell was last used in, not just any open slot. Dragging a backlog
        sample onto a ghost places it onto exactly that cell, proceeding immediately without the placement picker;
        clicking it instead opens a small popover with the cell&apos;s remaining uses, its exact expiry time, and a{" "}
        <b>Discard remaining use(s)</b> button for writing the cell off rather than reusing it — cells whose most
        recent use hasn&apos;t been confirmed loaded yet can&apos;t be discarded, mirroring the same rule on the
        Cell detail page.
      </p>

      <p className={styles.subheading}>Slot shading &amp; cell-link highlight</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_WINDOW_NEAR_DEADLINE} slotIndex={0} />
          </div>
          <span>
            <b>Slot shading:</b> a filled slot fades from full colour toward a paler tint the closer that cell gets
            to its own 108-hour deadline — the same fade used for waiting-cell ghosts above, just applied to a cell
            that&apos;s already loaded. Always that one cell&apos;s own clock; cells sharing a physical tray
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
            ring with a filled dot on the slot you&apos;re hovering or have pinned.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={STAGE_EXAMPLE_PEER} slotIndex={4} linked />
          </div>
          <span>Another use of that same physical cell, wherever it lands on the calendar — a dashed ring, hollow dot.</span>
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

      <p className={styles.subheading}>Blocked &amp; used-up wells</p>
      <div className={styles.legendGrid}>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} blocked />
          </div>
          <span>
            <b>Blocked:</b> once a physical cell is stopped, its well is retired for the rest of that tray&apos;s time
            on the instrument — no waiting-cell ghost appears there and no new cell can be loaded into that exact
            slot. The block lifts only once that physical tray leaves and a brand-new tray is loaded into the same
            bay on a later day, since that later tray&apos;s cell is a different physical object.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_EXHAUSTED} />
          </div>
          <span>
            <b>Used-up:</b> a cell that reaches a terminal state on its own — Exhausted (every lawful use spent),
            Window expired (the 108-hour window closed with capacity unused), or manually Retired — still shows a
            small status card rather than permanently blocking the well. Whether the well accepts a new cell
            depends on its three tray siblings: while any still has real capacity, the well stays read-only; only
            once every sibling has gone terminal does it behave like a plain <b>+</b> again.
          </span>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.ghostExampleSwatch}>
            <SchedulerSlotView stage={null} slotIndex={0} ghost={GHOST_EXAMPLE_SCHEDULED} />
          </div>
          <span>
            <b>Scheduled:</b> a cell whose remaining uses are already fully booked for later days — e.g. its next
            use is Wednesday while today&apos;s locked column falls in between — shows this plain card instead of
            jumping straight to Exhausted/Window expired, since it hasn&apos;t actually reached the end of its own
            lifecycle yet. It switches to the real terminal card once the calendar reaches that day. It only appears
            from the tray&apos;s first use onward — on any week before the tray is loaded, that well is just a plain
            empty <b>+</b>. Informational only, same as Used-up — never a drop target, no click-to-open popover.
          </span>
        </div>
      </div>
    </div>
  );
}

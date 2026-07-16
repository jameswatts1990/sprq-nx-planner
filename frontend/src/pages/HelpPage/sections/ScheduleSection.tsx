import styles from "../HelpPage.module.css";

export function ScheduleSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> the weekly planning grid. Rows are your active instruments; columns are
        days. You place backlog samples into instrument/day slots here.
      </p>
      <p>
        <b>Moving through time:</b> <b>‹ Prev</b> and <b>Next ›</b> page the view by 7 days; <b>Today</b> jumps
        back to the current window. The date range is shown between them, and it&apos;s remembered in the page URL
        so you can bookmark or share a week.
      </p>
      <p>
        <b>Weekends aren&apos;t shown</b> — the grid only has Monday-Friday columns, because runs aren&apos;t
        started at weekends.
      </p>
      <p>
        <b>Print Batch Sheet</b> opens a printable loading sheet for the Revios. Pick a day and tick which
        instruments to include — handy when different people load different machines, since each person can print
        just their own. The sheet opens in a new tab with every well&apos;s cell code, use number and 108-hour
        reuse deadline, the sample to load and its barcode(s)/container, and the run settings (adaptive loading,
        CCS kinetics, full-resolution baseQ, OPLC, volume) — everything needed to find the right samples, load them
        in the right wells, and set up the run. Use the page&apos;s <b>Print / Save as PDF</b> button, which opens
        your browser&apos;s normal print dialog (choose a physical printer, or &quot;Save as PDF&quot;).
      </p>
      <p>
        <b>Run design</b> (collapsible panel) sets the parameters used for both single placements and auto-fill:
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
          cost of using more cells.
        </dd>
      </dl>
      <p>
        <b>The Backlog panel</b> (collapsible, above the grid) has the same search box, priority dropdown, sort
        control, and rows-per-page control as the Backlog tab, so you can narrow down to the sample you want before
        dragging it — see the Backlog tab&apos;s help for details on each control.
      </p>
      <p>
        <b>Placing samples two ways:</b>
      </p>
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
        Priority badge — e.g. High before Standard). Among samples with the same priority, the one that&apos;s been
        sitting in the backlog longest goes first. Only after that does it consider what packs most efficiently.
      </p>
      <p>
        <b>The placement picker</b> appears after a drop only when there&apos;s an actual decision to make. When you
        drop a backlog sample onto an empty slot with more than one compatible open cell on that instrument, it
        offers <b>Use a new cell</b> (default) or any of those compatible cells. A cell is offered only if it still
        has a use left <i>and</i> none of its already-used (&quot;burned&quot;) barcodes clash with your
        sample&apos;s barcodes — running the same barcode twice on one cell isn&apos;t allowed. If there&apos;s no
        real choice — you dropped directly onto a waiting-cell ghost, or there are no reusable cells at all on that
        instrument — the picker skips itself entirely and proceeds automatically with a default{" "}
        <b>12:00 loading start time</b>, even if this is the first placement on that instrument/day. The picker only
        still stops to ask when your drop <i>would</i> start a brand-new run <i>and</i> there&apos;s a genuine cell
        choice to make (more than one compatible cell, with no ghost telling it which one you meant) — in that case
        it shows both the <b>Loading start time</b> field and the cell choice together. Dragging an already-placed
        sample to a new slot <b>moves</b> it and keeps its cell; a move that starts a brand-new run always shows the
        picker, since a move never auto-resolves.
      </p>
      <p>
        <b>Auto-schedule result note</b> summarises the outcome, e.g. &quot;12 placed · 3 unplaced · 1 cell(s)
        skipped · 2 window flag(s) · 1 barcode conflict(s)&quot;. A green note means everything placed cleanly; an
        amber note means some samples couldn&apos;t be placed, a cell&apos;s 108-hour window would be at risk, or a{" "}
        <b>barcode conflict</b> was found (two backlog samples in this batch share a barcode — they&apos;re kept off
        the same cell automatically, but review them before placing either); a red note means the auto-fill failed.
      </p>
      <p>
        <b>QC actions from the grid:</b> click a filled slot to open its detail, then <b>Mark Failed</b>,{" "}
        <b>Mark Aborted</b>, or <b>Stop cell</b> — the same actions available on the Cell detail page, without
        leaving the schedule. <b>Mark Failed</b>/<b>Mark Aborted</b> only appear once that run has reached its
        scheduled start time (see the Cells tab&apos;s help for exactly when); <b>Stop cell</b> is available any
        time the cell isn&apos;t already stopped or retired. Each shows a short reason/notes box and a confirm step
        in the same popover before applying. Use <b>Mark Aborted</b> instead of <b>Mark Failed</b> when the
        run/instrument was the problem rather than the cell or sample — it returns the sample straight to the
        Backlog for rescheduling instead of marking it Failed. <b>Stop cell</b> also cancels every one of that
        cell&apos;s not-yet-run uses elsewhere on the grid (their samples go back to the Backlog too) — each stays
        visible as a <b>Blocked</b> slot (see below) rather than disappearing, so a day&apos;s plan never silently
        loses a placement without a trace.
      </p>
      <p>
        <b>Failed/Aborted/Stopped/Blocked indicator on the grid:</b> a slot outlined in colour, labelled{" "}
        <b>Failed</b>, <b>Aborted</b>, <b>Stopped</b>, or <b>Blocked</b>, flags a QC problem without opening it —{" "}
        a red ring for <b>Failed</b> (that specific use produced no usable data; the cell may still be fine for its
        other uses) or <b>Stopped</b> (the physical cell itself has been taken out of service for good, shown this
        way on every one of its slots still visible on the grid, even ones that themselves completed normally); a
        milder amber ring for <b>Aborted</b> (the run/instrument was the problem, not the cell — its sample is
        already back in the Backlog); and a yellow cross-hatched <b>Blocked</b> slot for a placement that was
        cancelled by a <b>Stop cell</b> action before it ever ran — a permanent, read-only marker (no drag, no
        Remove/Change cell) left in place of the placement that would have happened there.
      </p>
      <p>
        <b>Changing a placement&apos;s cell:</b> click a filled slot to open its detail, then <b>Change cell</b> to
        swap it onto a different open, compatible cell on the same instrument — or onto a brand-new cell — without
        moving it off its current day/slot. The same compatibility rules as placement apply: a cell is offered only
        if it still has a use left and none of its burned barcodes clash with this sample&apos;s. Unavailable once
        the run is locked. This is the counterpart to dragging a placed sample to a different slot, which moves it
        but always keeps its existing cell — <b>Change cell</b> is for the opposite mistake, the right slot but the
        wrong cell.
      </p>
      <p>
        <b>Removing placements:</b>
      </p>
      <ul>
        <li>
          Click a filled slot to open its detail, then <b>Remove from schedule</b>.
        </li>
        <li>
          Or select placed samples and press <b>Remove from schedule (Del)</b> — the Delete/Backspace key does the
          same, as long as you&apos;re not typing in a text box.
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
      <p>
        <b>Run status on each day cell:</b>
      </p>
      <ul>
        <li>
          <b>Confirm loaded</b> appears once a day has at least one sample; press it when the cells are physically
          loaded on the instrument. This locks the run (marks it running/LOADED) so it can no longer be edited by
          accident.
        </li>
        <li>
          A <b>LOADED</b> tag marks a locked run; <b>Unlock</b> returns it to planned so you can edit it again.
        </li>
        <li>
          <b>Locked until [date/time]</b> means the run&apos;s instrument stays reserved past this day (a long
          movie), so later days show a &quot;Locked until…&quot; note even though no run starts on them.
        </li>
      </ul>
      <p>
        <b>Slots and trays:</b> each day cell has two trays of four slots, each drawn as its own bordered card so a
        tray&apos;s four cells read as one physical object — they always stay together. Tray 2 only appears once a
        sample is loaded. The Use 1 / Use 2 / Use 3 colours (magenta / blue / teal) show which use of a cell each
        barcode chip belongs to — see the Colour &amp; Status Legend section. A physical cell also always stays in
        the exact same tray/well position for every one of its reuses, never just any open slot — so once a cell
        has a well of its own, both the placement picker and <b>Change cell</b> only offer it for a drop into that
        same well, and its waiting-cell ghost (below) only ever appears there. There is deliberately no way to
        start a brand-new cell in a slot that already belongs to another cell&apos;s reuse; a cell&apos;s first use
        can start in any open slot, but from then on it&apos;s pinned.
      </p>
      <p>
        <b>Highlighting the same cell over time:</b> resting the pointer on a loaded slot for about a second and a
        half highlights every other slot elsewhere in the schedule that holds the <i>same physical cell</i> (its
        other uses, wherever they land on the calendar), and softens everything else — useful for tracing one
        cell&apos;s reuse across days without having to read every cell code. Moving on before then cancels it, so
        just scanning across the grid doesn&apos;t flash highlights. <b>Shift-click</b> a slot (or press{" "}
        <b>Shift+Enter</b> while it&apos;s focused) to pin the highlight immediately, with no wait, so it stays put
        while you move the mouse elsewhere; press <b>Escape</b> or click anywhere outside a loaded slot to clear it.
        The highlight is suspended while dragging a sample.
      </p>
      <p>
        <b>Waiting-cell ghosts:</b> once a multi-use cell&apos;s last placed use passes, an empty slot on the
        <i> earliest day it could next be loaded</i> — on the same instrument, one weekday after that last use —
        shows a tinted &quot;Use N · by [date]&quot; placeholder instead of the plain <b>+</b>, coloured the same as
        a real Use 2/3 chip and labelled with the exact day its 108-hour window closes. It keeps showing on every
        later day the cell is still eligible, fading from full colour toward a paler tint as that expiry date nears,
        until the actual last day it could still start — that day switches to a solid amber &quot;expires today&quot;
        look instead of continuing to fade, so the final opportunity never reads as &quot;about to
        vanish&quot;. If Use 1 hasn&apos;t
        been confirmed loaded yet, the expiry date shown is an estimate from its planned loading time rather than the
        real 108-hour clock (which only starts once the cell is actually removed from the tray) — the ghost always
        expires on schedule either way, it never reads as available indefinitely. It always shows up in the exact
        well the cell was last used in (see &quot;Slots and trays&quot; above), not just any open slot. If two
        different cells become eligible on the same instrument and day, each gets its own tinted placeholder in its
        own well — in the rare case both cells last sat in the same well letter, only one can show that day.
        Dragging a backlog sample onto
        a ghost places it onto exactly that cell — since the choice is already unambiguous, it proceeds immediately
        without the placement picker appearing at all; clicking it instead opens a small popover with the
        cell&apos;s remaining uses, its exact expiry time, and a <b>Discard remaining use(s)</b> button for writing
        the cell off rather than reusing it —
        cells whose most recent use hasn&apos;t been confirmed loaded yet can&apos;t be discarded, mirroring the same
        rule on the Cell detail page.
      </p>
    </div>
  );
}

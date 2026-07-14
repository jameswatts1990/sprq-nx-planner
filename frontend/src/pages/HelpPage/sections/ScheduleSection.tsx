import styles from "../HelpPage.module.css";

export function ScheduleSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> the two-week planning grid. Rows are your active instruments; columns are
        days. You place backlog samples into instrument/day slots here.
      </p>
      <p>
        <b>Moving through time:</b> <b>‹ Prev</b> and <b>Next ›</b> page the view by 14 days; <b>Today</b> jumps
        back to the current window. The date range is shown between them, and it&apos;s remembered in the page URL
        so you can bookmark or share a week.
      </p>
      <p>
        <b>Weekend columns are closed</b> — greyed out and not selectable, because runs aren&apos;t started at
        weekends in this view.
      </p>
      <p>
        <b>Run design</b> (collapsible panel) sets the parameters used for both single placements and auto-fill:
      </p>
      <dl className={styles.terms}>
        <dt>Max uses per cell (1× / 2× / 3×)</dt>
        <dd>
          How many times auto-fill will try to reuse each SMRT cell before opening a new one. A cell physically
          supports up to 3 acquisitions.
        </dd>
        <dt>Movie / run time (12 h / 24 h / 30 h)</dt>
        <dd>The sequencing movie length applied to runs you create.</dd>
        <dt>Optimise for</dt>
        <dd>
          <b>Fewest cells</b> (lowest cost, reuses cells hardest), <b>Balance</b> (trades off cost and speed), or{" "}
          <b>Fastest</b> (spreads across cells to finish in the fewest days).
        </dd>
      </dl>
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
          from the backlog using your Run design settings.
        </li>
      </ol>
      <p>
        <b>The placement picker</b> appears after a drop. When you drop a backlog sample it offers{" "}
        <b>Use a new cell</b> (default) or any compatible cell already in use on that instrument. A cell is offered
        only if it still has a use left <i>and</i> none of its already-used (&quot;burned&quot;) barcodes clash with
        your sample&apos;s barcodes — running the same barcode twice on one cell isn&apos;t allowed. If there are no
        reusable cells, you&apos;ll see &quot;No reusable cells in use on [instrument] — a new cell will be used,&quot;
        and it proceeds automatically. When your drop starts a brand-new run for that instrument/day, a{" "}
        <b>Loading start time</b> field appears (default 09:00) — that&apos;s the only case where the picker stops
        to ask. Dragging an already-placed sample to a new slot <b>moves</b> it and keeps its cell.
      </p>
      <p>
        <b>Auto-schedule result note</b> summarises the outcome, e.g. &quot;12 placed · 3 unplaced · 1 cell(s)
        skipped · 2 window flag(s)&quot;. A green note means everything placed cleanly; an amber note means some
        samples couldn&apos;t be placed or a cell&apos;s 108-hour window would be at risk; a red note means the
        auto-fill failed.
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
          <b>Clear schedule (N planned)</b> wipes every <i>planned</i> placement in the current two-week view and
          returns those samples to the backlog. A confirmation dialog first states exactly how many samples will be
          removed and warns it can&apos;t be undone. Confirmed/loaded runs are never touched, so the number cleared
          can be lower than the total on screen.
        </li>
      </ul>
      <p>
        <b>Run status on each day cell:</b>
      </p>
      <ul>
        <li>
          A small pulsing dot means the instrument is actively sequencing that run right now (hover text:
          &quot;Instrument is actively sequencing this run&quot;).
        </li>
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
        <b>Slots and trays:</b> each day cell has two trays of four slots. Tray 2 only appears once a sample is
        loaded. The Use 1 / Use 2 / Use 3 colours (magenta / blue / teal) show which use of a cell each barcode chip
        belongs to — see the Colour &amp; Status Legend section.
      </p>
    </div>
  );
}

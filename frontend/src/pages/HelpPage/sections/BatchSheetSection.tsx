import styles from "../HelpPage.module.css";

/** The Batch Sheet page (pages/BatchSheetPage/*): the on-screen Traction-entry view, Load (the shared
 * Confirm loaded dialog) and the printed loading sheet with its worksheets. */
export function BatchSheetSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>Batch Sheet</b> (the pink-tinted button with a clipboard icon, top right of the Schedule toolbar) shows a
        day&apos;s runs ready to enter into <b>Traction</b>, and prints the paper loading
        sheet when you need one. Pick the <b>load day</b> and tick which instruments to include — handy when different
        people load different machines — then click <b>View sheet</b>. It opens in place of the schedule; <b>◂ Schedule</b>
        above its title returns you.
      </p>
      <p>
        The sheet shows <b>one instrument at a time</b>. The title line gives the instrument, run, load day and
        status; at its right, the <b>‹</b> and <b>›</b> arrows step to the previous or next instrument (hover one to
        see which), and <b>Load</b> between them confirms this run has loaded (see below). Anything you&apos;ve ticked
        or copied on an instrument stays put while you look at another.
      </p>
      <p>
        On screen, each run is laid out <b>in the same order as Traction&apos;s run form</b>, top to bottom, so you can
        fill Traction in straight off the screen:
      </p>
      <ul>
        <li>
          <b>Reminders</b> at the top of the run, only when something needs attention. A <b>red</b> note means a
          well&apos;s cell is past its 108-hour reuse window. An <b>amber</b> note means the wells disagree on{" "}
          <b>Adaptive Loading</b>: Traction sets <i>Use Adaptive Loading</i> once for the whole run (it greys it out in
          each well&apos;s form), so you&apos;ll need to choose one value. <b>Blue</b> notes tell you when the whole run
          uses a non-default Adaptive Loading (set it in Well Defaults), which wells have non-default settings, and which
          wells have no recorded library concentration.
        </li>
        <li>
          <b>Run Details · Run Name</b>: Traction generates the run name. Note it down, because you enter it when you
          press <b>Load</b>. Once it&apos;s recorded, it shows here with a copy button.
        </li>
        <li>
          <b>Well Defaults</b>: the values to set in Traction&apos;s Well Defaults before adding wells: the movie
          acquisition time, include base kinetics, use adaptive loading (this run&apos;s own value, which applies to the
          whole run) and full resolution base qual. They come from the <b>Settings</b> tab&apos;s Sample defaults and
          default movie time, which match Traction&apos;s own presets out of the box. If Include Base Kinetics or Full
          Resolution Base Qual is <b>True</b>, it shows as a <b>magenta</b> label so it can&apos;t be missed.
        </li>
        <li>
          <b>Pre-flight checklist</b>, beside Well Defaults: tick boxes for the bench checks before loading
          (humidity above 25% rH, tips refilled, deck reloaded, excess cells disposed if required). The ticks are a
          reminder only. They aren&apos;t saved, and reset if you reload the page.
        </li>
        <li>
          <b>Plates</b>: Plate 1 and Plate 2 side by side, each with wells <b>A1–D1</b> stacked just as Traction draws
          them (Traction calls both plates&apos; wells A1–D1). Each plate is headed with the day it sequences, e.g.{" "}
          <i>&quot;Plate 2 · acquires Fri 25 Jul · reuse (Use 2)&quot;</i>. An unused position says <i>Empty</i>, and a
          run without a Plate 2 says to leave it empty in Traction.
        </li>
      </ul>
      <p>
        Each well&apos;s card shows its cell and use, then the values for Traction&apos;s well form. <b>Barcode</b> (the
        Pool ID), <b>Library Concentration (pM)</b> (the sample&apos;s Actual OPLC) and, beneath it,{" "}
        <b>Volume of Library Pool Used (uL)</b> (imported from Benchling or the tracker sheet) are <b>copy buttons</b>: click
        one, see <b>✓ Copied</b>, and paste it into the matching Traction field. If your browser blocks the copy, the
        value is selected for you with <i>Press Ctrl+C</i>, so you can copy it by hand. Once you&apos;ve copied a
        well&apos;s barcode the card shows <b>✓ copied</b>, to help you keep your place across the run (this resets if
        you reload the page). A well with no recorded concentration or volume says so (and a note above the run lists
        those wells), for you to enter in Traction. Under{" "}
        <b>Settings</b>, a well that matches the Well Defaults says <i>Defaults</i>; otherwise each setting to change in
        that well&apos;s form shows as a chip, such as <b>30h</b> or <b>Kinetics False</b> (dark), or{" "}
        <b>Kinetics True</b> (magenta, as for any setting switched on). Hover a chip to see the default. Adaptive Loading never appears per well, because Traction sets it for the whole run. Any sample note
        on the cell shows at the bottom of the card.
      </p>
      <p>
        To the right of the fields, two tiles show the well&apos;s <b>final loading dilution</b> volumes for the bench:{" "}
        <b>Complex</b> (the cleaned complex volume) in a test tube with pink liquid, and <b>Buffer</b> (the loading
        buffer volume) in a grey vial. Hover a tile to see its full name. These aren&apos;t Traction fields, so
        there&apos;s nothing to copy. The fuller vessel holds the larger of the two volumes, as a quick check, but
        always pipette from the number. A dashed, empty tile says <i>Not recorded</i>: add the volume by editing the
        sample, or work it out at the bench (the printed sheet leaves a box to write it in). On a narrow screen the
        tiles move below the fields.
      </p>
      <p>
        <b>Load</b> confirms the instrument has loaded, straight from the sheet. It does exactly what{" "}
        <b>Confirm loaded</b> on the schedule does: it locks the whole run (both plates). Check <b>your name</b> (filled in
        from the name in the top bar, and recorded against the action), the <b>Traction run name</b>{" "}
        (optional) and the time the Revio was loaded. The time starts at <i>now</i>; type any hh:mm, or click an hour
        on the dial to set it in one click. If the pre-flight checklist isn&apos;t fully ticked, the dialog lists
        what&apos;s left as a reminder, but it doesn&apos;t stop you. Once loaded, the button reads <b>✓ Loaded</b>.
        To undo it, use <b>Unload</b> on the schedule.
      </p>
      <p>
        <b>Print / Save as PDF</b> prints the <b>paper loading sheet</b> rather than the on-screen layout, for{" "}
        <b>every</b> instrument you picked (not just the one on screen), through your browser&apos;s normal print
        dialog (choose a physical printer, or &quot;Save as PDF&quot;). It prints{" "}
        <b>landscape, one run per page</b>, so each Revio&apos;s run is a self-contained page you can hand to whoever
        loads it, and a saved PDF is named <i>&quot;YYYY.MM.DD - Revio &lt;serial&gt;&quot;</i> (the load day and the
        instrument). Each page has a table split into a block per plate. Each well shows its cell code, use number and
        108-hour reuse deadline, the sample to load and its <b>Plate ID</b>, the per-cell run settings (movie / run
        time, adaptive loading, include base kinetics, full-resolution baseQ) and the <b>Actual OPLC</b>, with the{" "}
        <b>Volume of Library Pool Used</b> beneath it (e.g. <i>4.5 µL pool</i>) when it was imported. Any setting
        that differs from the Sample Defaults (Settings tab) is printed in <b>bold with a &quot;*&quot;</b>, explained
        by a footnote under the table. A <b>Date</b> and <b>Signed / initials</b> box sits top-right to sign off the
        load, and a final <b>Notes</b> column prints any note you&apos;ve added to a sample on its cell (see{" "}
        <b>Sample notes</b> under QC actions below).
      </p>
      <p>
        Below each run&apos;s table the paper sheet also prints two <b>fill-in worksheets per plate</b> to record the bench
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
    </div>
  );
}

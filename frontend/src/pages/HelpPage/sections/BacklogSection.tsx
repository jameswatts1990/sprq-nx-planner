import { Badge } from "@/components/ui/Badge";
import { ABORTED_PRIORITY, RECOVERABLE_PRIORITY, REPEATABLE_PRIORITY, priorityTone } from "@/utils/priority";

import styles from "../HelpPage.module.css";

const PRIORITY_EXAMPLES = [
  RECOVERABLE_PRIORITY,
  REPEATABLE_PRIORITY,
  ABORTED_PRIORITY,
  "High (1)",
  "Medium (2)",
  "Standard (3)",
];

export function BacklogSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> every sample that has been imported but not yet placed on the schedule. The
        count in the header is the total waiting.
      </p>

      <p className={styles.subheading}>Filters &amp; search</p>
      <p>
        <b>Search</b> by Container ID, barcode, parent sample, or priority; results narrow as you type. Use the{" "}
        <b>priority dropdown</b> to narrow the list to one priority value — it only lists priorities that are
        actually present in the backlog, so a choice never comes back empty. The <b>rows-per-page</b> control (25 /
        50 / 100 / 200, defaulting to 50) sets how many samples are shown at once.
      </p>

      <p className={styles.subheading}>Columns &amp; sorting</p>
      <p>
        <b>Columns:</b> Container ID, Barcodes, Parent sample, Sanger IDs, Priority, Target OPLC, Actual OPLC, Adaptive
        loading, Full res. base Q, Include base kinetics, and Created (when it was imported). <b>Target OPLC</b> is the
        planned loading concentration; <b>Actual OPLC</b> is the concentration actually achieved on the plate. A dash
        (—) means that field is empty for the sample. Click a <b>Container ID</b> to open that sample&apos;s detail page.
        A <b>1/3</b> badge beside a Container ID means it&apos;s a <b>duplicate</b> — the same sample entered more than
        once so it can be run across multiple cells; &ldquo;1/3&rdquo; is copy 1 of 3 (counted across every status,
        including completed).
      </p>
      <p>
        <b>Sorting:</b> click <i>any</i> column header to sort by that field; click it again to reverse the
        direction. An arrow (▲/▼) on the header shows the active sort and direction. Empty cells (shown as —) always
        sit at the bottom, whichever direction you choose, so a blank never floats to the top. Priority sorts by rank
        (High before Standard), not alphabetically; samples that share a priority are then ordered by Container ID —
        the same order the scheduler processes them in.
      </p>
      <p>
        <b>Priority</b> shows as a coloured badge so the most urgent samples stand out at a glance, both here and
        on the draggable cards in the Schedule tab&apos;s Backlog panel. A sample imported without a priority is
        treated as <b>Standard</b> — it shows an explicit Standard badge rather than a blank, so a priority is never
        left to guess. The colours run from calm to urgent — Standard, then Medium, then High — with Aborted and the
        &quot;returned to the backlog&quot; labels (Recoverable / Repeatable) set apart in their own colour:
      </p>
      <div className={styles.legendGrid}>
        {PRIORITY_EXAMPLES.map((p) => (
          <div className={styles.legendRow} key={p}>
            <span className={styles.legendSwatchLabel}>
              <Badge tone={priorityTone(p)}>{p}</Badge>
            </span>
          </div>
        ))}
      </div>
      <p className={styles.subheading}>Recoverable Samples (above the backlog)</p>
      <p>
        When a <b>Cell QC</b> action (see the Schedule and Cells tabs&apos; help) takes a cell out of service, the
        samples on its later uses shift onto the tray&apos;s other cells and the tail may drop off. Any sample you
        dispositioned <b>Repeatable</b> or <b>Recoverable</b> comes back here into a <b>Recoverable Samples</b>{" "}
        section shown <i>above</i> the main backlog, bumped above High priority so it&apos;s rescheduled first.
        Rescuing one is no different from scheduling any other backlog sample: drag it (or place it via Auto Schedule)
        onto a cell. A <Badge tone="info">N recoverable</Badge> count appears in the header while any are waiting. Its
        column headers are clickable to sort, just like the main backlog (it starts sorted by priority).
      </p>
      <p className={styles.subheading}>Top-up required (below the backlog)</p>
      <p>
        Samples you dispositioned <b>Lost</b> (their material is gone and needs re-requesting) appear in a{" "}
        <b>Top-up required</b> list <i>below</i> the backlog, showing the run/cell the loss came from. Click{" "}
        <b>Request Sent</b> once you&apos;ve asked the submitter for fresh material — it records today&apos;s date on
        the entry — or <b>Cancel</b> to remove it from the list. This is separate from the cell-level PacBio credit
        workflow (which recovers the wasted <i>cell</i>, not the sample). Click any column header to sort this list.
      </p>
      <p>
        <b>Aborted</b> is a legacy top-priority label: if any sample carries it, a red{" "}
        <Badge tone="danger">⚠ N aborted</Badge> badge appears next to the sample count here and in the Schedule
        tab&apos;s Backlog panel header so it&apos;s never missed.
      </p>
      <p>
        Whenever any backlog sample is rated <b>High</b> priority or above (Aborted / Recoverable / Repeatable all
        rank above High), an amber{" "}
        <Badge tone="warning">⚠ N high priority+ unscheduled</Badge> badge appears next to the sample count here and
        in the Schedule tab&apos;s Backlog panel header — a reminder that urgent samples are still waiting to be
        placed, even while the panel is collapsed.
      </p>

      <p className={styles.subheading}>Actions</p>
      <p>
        <b>+ Add sample</b> (top-right of the toolbar) opens a form to add one sample to the backlog by hand — handy
        when a sample isn&apos;t in a file to import. <b>Container ID</b> and at least one <b>barcode</b>{" "}
        are required (enter several barcodes separated by commas or spaces); every other field is optional. The
        three True/False settings (Adaptive Loading, Full-Resolution Base Q, Include Base Kinetics) and Priority
        (Standard / Medium / High) are chosen from a dropdown, and start on the defaults set in the Admin tab&apos;s{" "}
        <b>Sample defaults</b> panel — change any of them before saving. The new sample lands in the backlog exactly
        like an imported one. If the Container ID has been seen before (any status, including completed), the form
        doesn&apos;t reject it — it tells you how many times it&apos;s been seen and offers <b>Add anyway</b> to create
        another copy (for running the same sample across multiple cells). Click Add anyway to confirm, or change the
        Container ID if it was a mistake.
      </p>
      <p>
        <b>Edit</b> (on each row) opens the same form to correct a backlog sample&apos;s details — barcodes, Sanger
        IDs, priority, Target OPLC, Actual OPLC, the complex-loading volumes (cleaned-complex and loading-buffer,
        which pre-fill the batch sheet&apos;s dilution worksheet), and the other settings. The{" "}
        <b>Container ID</b> is greyed out and can&apos;t be changed: it identifies the sample and is fixed once
        created. A backlog sample is fully editable; once it&apos;s scheduled you can still adjust its loading
        parameters (including those volumes) from the Schedule slot popover, but its barcodes and identity are locked.
      </p>
      <p>
        <b>Loading buffer is worked out for you.</b> Complex and loading buffer always top up to <b>25 µL</b>
        together, so the form fills in <b>Loading Buffer Vol</b> automatically as <b>25 − Cleaned Complex Vol</b> as
        soon as you enter the complex volume. You can still type a different value if a particular sample needs it —
        the form then shows a warning that the two no longer add up to 25 µL, with a one-click link to put it back to
        the calculated value. The same behaviour applies everywhere this form appears (Add sample, Edit, and the
        Schedule slot popover).
      </p>
      <p>
        <b>Movie time (h)</b> is a per-sample setting — 12, 24, and 30 h are the usual instrument values — you can
        import it (a &quot;Movie time&quot; column) or type it on the add/edit form, which takes any number and
        defaults to <b>24 h</b> when not given. When you drag a sample onto the schedule it runs for its own movie
        time by default (you can still fine-tune the per-cell run time from the slot popover afterwards).
      </p>
      <p>
        <b>Cancel</b> (on each row) removes a sample from the backlog when you never intend to sequence it. Use it
        to clear out mistakes or withdrawn samples; it does not delete sequencing history. If a cancel fails, a red
        note explains why.
      </p>
      <p>
        The same backlog also appears as draggable cards inside the Schedule tab&apos;s Backlog panel, with the same
        search, priority filter, and rows-per-page controls. Sorting there is a compact dropdown (Created, Container
        ID, Barcode, or Priority) plus a direction button rather than clickable column headers, since that panel is a
        card list, not a table. Each card shows the sample&apos;s parent sample, a coloured <b>priority</b> badge, and
        its <b>movie time</b> (e.g. ⏱ 24 h), with a coloured left edge matching its priority. Drag a card onto a slot to
        schedule it, or <b>click</b> it to open that sample&apos;s detail page (the ✎ button in the card&apos;s corner
        still opens the quick edit form). To cancel a sample, use the Backlog tab.
      </p>
    </div>
  );
}

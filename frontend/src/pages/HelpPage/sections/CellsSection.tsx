import styles from "../HelpPage.module.css";

export function CellsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> browsing every physical SMRT cell the system knows about and its current
        state.
      </p>
      <p>
        <b>Filters:</b> the chips (All, Open, Exhausted, Window expired, Retired) filter by cell status; the
        dropdown filters by instrument; <b>Search</b> matches cell code or barcode. The page opens on <b>Open</b>{" "}
        cells by default.
      </p>
      <p>
        <b>Each cell card shows:</b> the cell code, a status badge, uses spent (e.g. &quot;1 / 3 uses&quot;), which
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
          <b>Uses</b> spent / total and remaining; <b>Window elapsed</b> in hours; <b>Window breached</b> Yes/No;{" "}
          <b>Current location</b> (instrument · well); <b>First use started</b> and <b>Created</b> timestamps; and
          the cell&apos;s <b>Burned barcodes</b>.
        </li>
        <li>
          <b>Retire cell</b> takes a cell permanently out of service. It&apos;s disabled — with a hover explanation
          — when the cell still has planned (not-yet-started) uses (&quot;Cannot retire a cell with planned (not
          yet started) uses.&quot;) or is already retired (&quot;Cell is already retired.&quot;). Remove or complete
          its planned uses first if you need to retire it.
        </li>
        <li>
          <b>Use history</b> lists every run the cell has been in: run number (links to the run), well, use status,
          sample, container ID, barcodes, priority, target OPLC, adaptive loading, full resolution base Q, kinetics
          (CCS output includes kinetics information), instrument, start/complete times, and any outcome notes.
        </li>
      </ul>
    </div>
  );
}

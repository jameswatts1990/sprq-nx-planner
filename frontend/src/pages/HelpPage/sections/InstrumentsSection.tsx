import styles from "../HelpPage.module.css";

export function InstrumentsSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> managing the Revio/SPRQ-Nx instruments that runs are scheduled onto. Each
        instrument shows as a card with its status and a few at-a-glance figures. This is where you add a new Revio,
        rename one, take one out of service for maintenance, or remove one added by mistake.
      </p>

      <p className={styles.subheading}>Adding, naming and removing instruments</p>
      <p>
        <b>Add instrument</b> (top right) registers a new Revio. Its <b>serial number</b> is the instrument&apos;s own
        identity (e.g. 84047) and can&apos;t be changed afterwards. The <b>name</b> is an optional friendly label
        (e.g. &quot;Revio A&quot;) — when set, it&apos;s what shows in the Schedule, with the serial as a small
        subtitle beneath; leave it blank and the Schedule just shows the serial. <b>Edit</b> changes the name.
      </p>
      <p>
        <b>Retire</b> hides an instrument from the Schedule and the instrument dropdowns but keeps all its history —
        use it for a Revio that&apos;s left the lab. A retired instrument can be <b>Reactivated</b> at any time.{" "}
        <b>Delete</b> removes an instrument entirely, and is only possible while it has no run or tray history (so
        it&apos;s really only for one added by mistake) — otherwise Retire it instead.
      </p>

      <p className={styles.subheading}>Down for maintenance</p>
      <p>
        <b>Mark down</b> takes an instrument out of service from a date you choose (with an optional reason). From
        that date the instrument&apos;s row in the Schedule greys out and takes <b>no new runs</b> — neither by
        dragging a sample onto it nor via Auto Schedule — until you bring it back. Days <em>before</em> the down
        date, and any run already scheduled, are left untouched. <b>Bring online</b> clears the flag and the
        instrument is immediately available again. This is different from Retire: a down instrument is temporarily
        out but still shown; a retired one is hidden entirely.
      </p>

      <p className={styles.subheading}>The figures on each card</p>
      <ul>
        <li>
          <b>Currently running</b> — the run sequencing on the instrument right now (its name or number) and when the
          instrument next frees up; &quot;idle&quot; when nothing is running.
        </li>
        <li>
          <b>Open trays</b> — how many SMRT cell trays with spare capacity are sitting on the instrument. Click the
          number to jump to those cells on the Cells tab.
        </li>
        <li>
          <b>Cells (open)</b> — how many of the instrument&apos;s cells are still usable, out of the total on it.
        </li>
        <li>
          <b>Total runs</b> and <b>Next run</b> — how many runs it has held (and when the last one loaded), plus the
          next scheduled run date.
        </li>
      </ul>

      <p className={styles.subheading}>Status badge</p>
      <p>
        Each card shows one status at a glance: <b>Ready</b> (available), <b>Running</b> (a run is sequencing on it
        now), <b>Down</b> (marked down for maintenance), or <b>Inactive</b> (retired).
      </p>
    </div>
  );
}

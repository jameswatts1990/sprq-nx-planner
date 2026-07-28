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
          <b>Currently running</b> — the run on the instrument right now (its name or number) and when it finishes and
          the instrument frees up; &quot;idle&quot; when nothing is loaded. A run counts as running the whole time its
          cells are on the instrument — from load, through prep and sequencing, right until the last cell&apos;s PPA
          finishes — measured from when it was <em>actually</em> loaded (the time entered at Confirm loaded), not just
          the first hour or two.
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

      <p className={styles.subheading}>What it&apos;s doing right now</p>
      <p>
        When a run is in progress, a green dot and a short live summary spell out what the instrument is doing at this
        moment — e.g. <b>&quot;3 sequencing · 2 in PPA · 1 awaiting prep&quot;</b> — counting each loaded cell by the
        stage it&apos;s in. An amber <b>prep-locked</b> chip appears while any cell is still being (or still waiting to
        be) broken out: the instrument is committed and can&apos;t take a fresh tray until every cell has started prep.
        These counts use the same timings as the gantt below, measured from when the run was actually loaded.
      </p>

      <p className={styles.subheading}>Live run progress</p>
      <p>
        When an instrument has one or more runs <b>in progress right now</b>, its card shows a small live{" "}
        <b>stage-times gantt</b> — the same chart as the Schedule&apos;s slot popover. Each loaded well is a row with
        its three stages (a slate <b>prep</b> lead-in, the Use-coloured <b>movie</b>, then a darker slate <b>PPA</b>{" "}
        tail) laid out over a shared clock-time axis, and a green <b>live line</b> (with a spinning marker) sweeps down
        through every bar to show where sequencing has got to. Since the instrument can only run <b>two cells&apos; PPA
        at once</b>, later cells show a short hatched <b>&quot;waiting for PPA&quot;</b> gap before their PPA begins. If{" "}
        <b>two runs overlap</b> on the instrument they share the one chart — up to eight cells — separated by a divider
        so each run reads clearly. The timings are approximate PacBio estimates, not the instrument&apos;s exact
        schedule.
      </p>

      <p className={styles.subheading}>Status badge</p>
      <p>
        Each card shows one status at a glance: <b>Ready</b> (available), <b>Running</b> (a run is sequencing on it
        now), <b>Down</b> (marked down for maintenance), or <b>Inactive</b> (retired).
      </p>
    </div>
  );
}

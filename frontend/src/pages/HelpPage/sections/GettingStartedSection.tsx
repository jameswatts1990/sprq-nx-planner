import styles from "../HelpPage.module.css";

export function GettingStartedSection() {
  return (
    <div className={styles.copy}>
      <p>
        RunNx Planner tracks SMRT cells and schedules them across your Revio/SPRQ-Nx instruments. A typical week
        flows through the tabs left to right:
      </p>

      <p className={styles.subheading}>The weekly workflow</p>
      <ol>
        <li>
          <b>Import</b> the samples and barcodes you want to sequence (paste or upload a CSV).
        </li>
        <li>
          They land in the <b>Backlog</b> — everything imported but not yet scheduled.
        </li>
        <li>
          On the <b>Schedule</b> you drag backlog samples onto the grid, or select empty day slots (an instrument on
          a day) and let <b>Autoschedule</b> fill them.
        </li>
        <li>
          <b>QC &amp; credits</b> gathers every PacBio credit case — each cell chasing a credit after a failure or stop, plus any
          case you log there without a cell — grouped by stage, so you can action each one (report to PacBio, log the
          internal report, confirm and receive the credit) from one place.
        </li>
        <li>
          <b>Instruments</b> is where you add, rename or remove your Revios and mark one down for maintenance (which
          greys it out in the Schedule) — plus at-a-glance status for each.
        </li>
        <li>
          <b>History ▾</b> opens a short menu of the records: <b>Cells</b> shows every physical SMRT cell tray, how
          many of its uses are spent, and how much of its 108-hour lifetime window is left; <b>Runs</b> is the record
          of past, active and planned runs, with how each well went; <b>Samples</b> lists every sample — wherever
          it is now, and every run it has been on; and <b>Activity</b> shows who changed what, and when. History
          stays highlighted while you&apos;re on any of them.
        </li>
      </ol>

      <p className={styles.subheading}>Set your name</p>
      <p>
        The chip just left of the icons at the top right shows your name. Until you set one it reads{" "}
        <b>Set your name</b> in amber — click it, type your name and <b>Save</b>. Every change you make is then
        signed with it in <b>History → Activity</b>, and it fills in <b>Your name</b> when you confirm a run loaded
        and the owner of a new credit case. It&apos;s remembered in this browser only, so set it once on each computer
        you use (and change it if you&apos;re working at someone else&apos;s).
      </p>

      <p className={styles.subheading}>Nothing is final until a run is loaded</p>
      <p>
        Nothing you do on the Schedule is final until you mark a run as loaded — until then, placements are
        &quot;planned&quot; and can be moved or cleared freely.
      </p>

      <p className={styles.subheading}>Stats, Settings and Help</p>
      <p>
        The three icons in the box at the top right of every page open the reference screens (hover one for its name):
        the <b>bar chart</b> is <b>Stats</b>, which turns all of the above into charts — throughput, cell reuse,
        failures and credits, and inventory — so you can see at a glance how the lab is doing; the <b>cog</b> is{" "}
        <b>Settings</b>, which configures how this instance schedules runs and defaults new samples (and hides raw
        database tools for development use); and the <b>?</b> is this <b>Help</b> page, which documents every
        screen — see their sections below, or use the search box above to jump straight to a topic (<b>Enter</b> or{" "}
        <b>↓</b> steps to the next match, <b>Shift+Enter</b> or <b>↑</b> to the previous). Beside them is the
        app&apos;s version number and build date — click it to see what changed.
      </p>
      <p>
        <b>Help for the page you&apos;re on:</b> every page has a round <b>?</b> beside its title (on the Schedule,
        at the right end of its toolbar) that opens Help straight at that page&apos;s section. The{" "}
        <b>Keyboard shortcuts</b> section lists every key and Ctrl/Shift-click the app understands, and the{" "}
        <b>Glossary</b> explains the words RunNx uses (slot, day slot, use, plate…).
      </p>
    </div>
  );
}

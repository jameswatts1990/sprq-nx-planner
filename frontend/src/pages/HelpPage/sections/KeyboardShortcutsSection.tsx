import styles from "../HelpPage.module.css";

/** Every keyboard shortcut and modifier-click in the app, in one place. Keep in step with the
 * handlers it names (grid selection, the Schedule's Del key, search boxes, dialogs, inline edits). */
export function KeyboardShortcutsSection() {
  return (
    <div className={styles.copy}>
      <p>
        Everything in RunNx works with the mouse; these keys and clicks make the common jobs quicker. On a Mac use{" "}
        <b>Cmd</b> wherever this says <b>Ctrl</b>.
      </p>

      <p className={styles.subheading}>Schedule grid</p>
      <dl className={styles.terms}>
        <dt>Click an empty day slot</dt>
        <dd>Select it for Autoschedule (click it again to clear). <b>Enter</b> or <b>Space</b> does the same.</dd>
        <dt>Shift+click a day slot</dt>
        <dd>Select the whole rectangle from the last day slot you picked.</dd>
        <dt>Ctrl+click a day slot, a row header or a day header</dt>
        <dd>Add it to (or take it out of) what&apos;s already selected, instead of replacing it.</dd>
        <dt>Ctrl+click a placed sample</dt>
        <dd>Add it to (or take it out of) the sample selection. <b>Ctrl+drag</b> across cards selects a block of them.</dd>
        <dt>Ctrl+Shift+click a placed sample</dt>
        <dd>Extend the sample selection to it.</dd>
        <dt>Delete or Backspace</dt>
        <dd>
          Remove the selected samples from the schedule (back to the backlog) — the same as <b>Remove from schedule</b>.
          Ignored while you&apos;re typing in a box or a dialog is open.
        </dd>
        <dt>Shift+click a placed sample (or Shift+Enter on it)</dt>
        <dd>Pin the cell-link highlight: every use of that sample&apos;s cell lights up. <b>Esc</b> unpins it.</dd>
        <dt>Space or Enter on a planned sample, then the arrow keys</dt>
        <dd>
          Pick the card up and move it slot by slot without the mouse; <b>Space</b> or <b>Enter</b> again drops it,{" "}
          <b>Esc</b> puts it back.
        </dd>
        <dt>Enter on a loaded (locked) sample</dt>
        <dd>Open its detail — a loaded run&apos;s cards can&apos;t be moved.</dd>
      </dl>

      <p className={styles.subheading}>Search boxes</p>
      <dl className={styles.terms}>
        <dt>Enter / Shift+Enter</dt>
        <dd>
          In the Schedule search and the Help search: jump to the next / previous match (the <b>↓</b> /{" "}
          <b>↑</b> buttons beside the Help search do the same).
        </dd>
        <dt>Esc in the Schedule search</dt>
        <dd>Clear the search (press it again to leave the box).</dd>
      </dl>

      <p className={styles.subheading}>Dialogs and pop-ups</p>
      <dl className={styles.terms}>
        <dt>Esc</dt>
        <dd>
          Close the dialog on top — a picker opened from the Autoschedule panel closes on its own, leaving the panel
          open. Also closes the History, your-name, View options and upload menus.
        </dd>
        <dt>Tab / Shift+Tab</dt>
        <dd>Move between a dialog&apos;s fields and buttons; it stays inside the dialog until you close it.</dd>
        <dt>Arrow keys and Enter on the load-time dial</dt>
        <dd>Step the hour round the dial and pick it.</dd>
      </dl>

      <p className={styles.subheading}>Editing in place</p>
      <dl className={styles.terms}>
        <dt>Enter / Esc in a ✎ field</dt>
        <dd>Save / cancel an inline edit (a credit case&apos;s owner, case number, report ID…).</dd>
        <dt>Ctrl+Enter in a sample note</dt>
        <dd>Save the note; <b>Esc</b> cancels.</dd>
      </dl>
    </div>
  );
}

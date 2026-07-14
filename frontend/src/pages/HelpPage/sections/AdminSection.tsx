import styles from "../HelpPage.module.css";

export function AdminSection() {
  return (
    <div className={styles.copy}>
      <p>
        <b>What this tab is for:</b> raw database inspection and cleanup tools, intended for development use only.
        These tools operate directly on tables and rows, bypassing the app&apos;s normal scheduling rules — they
        are not part of the shipped/live product and are expected to be removed or disabled before a real
        production launch.
      </p>
      <p>
        The left-hand list shows every database table with its row count. Selecting one shows its rows in a
        paginated table (50 rows at a time), with a <b>Delete</b> button on each row.
      </p>
      <dl className={styles.terms}>
        <dt>Delete (a single row)</dt>
        <dd>
          Asks for confirmation, then permanently removes that one row. This can&apos;t be undone.
        </dd>
        <dt>Clear table</dt>
        <dd>
          Permanently deletes every row in the selected table — the table itself and its columns are kept, so it
          remains usable immediately afterward. Because this is irreversible, you must type the table&apos;s exact
          name into the confirmation dialog before the button enables.
        </dd>
      </dl>
      <p>
        The amber note at the top of the page is a standing reminder that these actions bypass business logic (for
        example, deleting a cell&apos;s row here doesn&apos;t check whether it has planned uses the way{" "}
        <b>Retire cell</b> on the Cells &amp; Instruments tab does) — use with care, and only against development
        data.
      </p>
    </div>
  );
}

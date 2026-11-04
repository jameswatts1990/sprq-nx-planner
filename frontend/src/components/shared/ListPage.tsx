import { useCallback, useState } from "react";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PAGE_SIZES } from "@/utils/listView";

import styles from "./ListPage.module.css";

/** Pieces shared by the list pages (Cells, Run history, Samples) - see ListPage.module.css. */

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((n) => ({ value: n, label: String(n) }));

/** "Rows 25 | 50 | 100 | 200", at the right-hand end of a list page's sub-bar. */
export function RowsPerPage({ value, onChange }: { value: number; onChange: (pageSize: number) => void }) {
  return (
    <div className={`${styles.control} ${styles.pushRight}`}>
      <span className={styles.controlLabel}>Rows</span>
      <SegmentedControl ariaLabel="Rows per page" options={PAGE_SIZE_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

/** The first cell of an expandable row. The whole row toggles on click; this button carries the
 * keyboard focus and the expanded state for screen readers. `label` names what opens, e.g.
 * "tray 12's cells". */
export function RowToggle({ expanded, label }: { expanded: boolean; label: string }) {
  return (
    <td className={styles.toggleCell}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} ${label}`}
      >
        <span className={expanded ? "disclosure open" : "disclosure"} aria-hidden="true">
          ▸
        </span>
      </button>
    </td>
  );
}

/** Which rows are open: a row is expanded when its key's toggled state differs from
 * `defaultExpanded`. Kept by key, so a row stays open across a refetch. `onToggle` is stable, so
 * memoized rows only re-render when their own data or open state changes. */
export function useRowToggles(defaultExpanded: boolean) {
  const [toggled, setToggled] = useState<ReadonlySet<string | number>>(() => new Set());
  const onToggle = useCallback(
    (key: string | number) =>
      setToggled((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const isExpanded = (key: string | number) => defaultExpanded !== toggled.has(key);
  return { isExpanded, onToggle };
}

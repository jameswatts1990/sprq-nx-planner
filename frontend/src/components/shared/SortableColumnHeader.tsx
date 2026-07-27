import styles from "./SortableColumnHeader.module.css";

export type SortDir = "asc" | "desc";

export interface SortableColumnHeaderProps {
  label: string;
  /** True when this column is the one the table is currently sorted by. */
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}

/** A table header rendered as a button so any column can be clicked to sort. Shows an
 * arrow (▲ asc / ▼ desc) on the active column. Shared by the server-sorted sample tables
 * and the client-sorted (Top-up, cell-use) tables so sorting looks and behaves the same
 * everywhere. */
export function SortableColumnHeader({ label, active, dir, onClick }: SortableColumnHeaderProps) {
  return (
    <button
      type="button"
      className={styles.sortHeader}
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className={styles.indicator} aria-hidden="true">
        {active ? (dir === "asc" ? "▲" : "▼") : ""}
      </span>
    </button>
  );
}

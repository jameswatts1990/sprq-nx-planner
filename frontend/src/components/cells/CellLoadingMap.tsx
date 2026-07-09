import type { PackedCellOut } from "@/types/schedule";

import { CellCard } from "./CellCard";
import styles from "./CellLoadingMap.module.css";

export interface CellLoadingMapProps {
  cells: PackedCellOut[];
}

/** Responsive grid of preview-time cell cards, used on the Plan page. */
export function CellLoadingMap({ cells }: CellLoadingMapProps) {
  if (cells.length === 0) {
    return <div className={styles.emptyMsg}>No cells.</div>;
  }
  return (
    <div className={styles.grid}>
      {cells.map((cell) => (
        <CellCard key={cell.cell_ref} cell={cell} />
      ))}
    </div>
  );
}

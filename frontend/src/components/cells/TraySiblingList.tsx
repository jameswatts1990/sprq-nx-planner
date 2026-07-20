import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import type { CellOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { windowHoursRemaining } from "@/utils/openTrays";
import { FADE_MIN_HOURS } from "@/utils/windowFade";

import styles from "./TraySiblingList.module.css";

export interface TraySiblingListProps {
  /** A physical tray's sibling cells, in tray-position order (the backend already sorts
   * by tray_position whenever a `tray_id` filter is used - see cells API). */
  cells: CellOut[];
  /** Highlights the row for this cell, when rendered from that cell's own detail page. */
  currentCellId?: number;
}

/** One physical SPRQ-Nx SMRT Cell tray's sibling cells, each showing its own status - a
 * tray never has a single merged status, since its cells' individual histories can
 * diverge (see docs/pacbio-sprq-nx-scheduling-reference.md's "Tray-of-4 eager
 * population"). Shared by CellDetailPage's "Cell tray" card and the Cells & Instruments
 * page's "Open trays" section, so both stay visually consistent - the same reasoning
 * cellStatus.ts's CELL_STATUS_TONE/CELL_STATUS_LABEL maps already document. */
export function TraySiblingList({ cells, currentCellId }: TraySiblingListProps) {
  return (
    <div className={styles.trayList}>
      {cells.map((sibling) => {
        const hoursRemaining = windowHoursRemaining(sibling);
        return (
          <Link
            key={sibling.id}
            to={`/cells/${sibling.id}`}
            className={sibling.id === currentCellId ? styles.trayItemCurrent : styles.trayItem}
          >
            <span className={styles.trayItemPosition}>
              {sibling.tray_position}/{sibling.tray_size}
            </span>
            <span className={styles.trayItemCode}>{sibling.code}</span>
            <Badge tone={CELL_STATUS_TONE[sibling.status]}>{CELL_STATUS_LABEL[sibling.status]}</Badge>
            <span className={styles.trayItemUses}>
              {sibling.uses_consumed}/{sibling.max_uses} uses
            </span>
            {hoursRemaining !== null && (
              <span className={hoursRemaining <= FADE_MIN_HOURS ? styles.trayItemExpiryUrgent : styles.trayItemExpiry}>
                {hoursRemaining <= 1 ? "<1h left" : `${Math.ceil(hoursRemaining)}h left`}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

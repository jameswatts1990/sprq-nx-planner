import { Link } from "react-router-dom";

import { chipClass, chipStyles } from "@/components/shared/statusChip";
import type { RunHistoryWellOut } from "@/types/schedule";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./RunWellStrip.module.css";

const WELL_LETTERS = ["A", "B", "C", "D"];

/** A cancelled use is the "Blocked" marker a stopped cell leaves on its later wells. */
function wellStatusText(status: string): string {
  return status === "cancelled" ? "blocked (cancelled)" : status;
}

/** The full sentence a well chip's tooltip and screen-reader label carry. */
export function describeWell(well: RunHistoryWellOut): string {
  return [
    `Plate ${well.plate_index} ${well.well}`,
    well.sample_pool_id ?? "no sample",
    `cell ${well.cell_code} (use ${well.use_number} of ${well.cell_max_uses})`,
    wellStatusText(well.status),
  ].join(" · ");
}

export interface RunWellStripProps {
  wells: RunHistoryWellOut[];
  /** Ring these wells (cell use ids) as the ones a search matched. */
  matchedIds?: ReadonlySet<number>;
  /** Router state for each chip's link, so the cell page's Back returns here. */
  linkState?: SampleDetailLocationState;
}

/** A run at a glance: its plates (P1, P2), each with a chip per well A-D coloured by how that
 * well's use went - grey planned, blue running, green completed, amber aborted, orange failed,
 * red blocked - the same colours as the use's status badge. A well with nothing loaded is an
 * empty dashed slot. Each chip links to the cell that ran in it. */
export function RunWellStrip({ wells, matchedIds, linkState }: RunWellStripProps) {
  const plates = [...new Set(wells.map((w) => w.plate_index))].sort((a, b) => a - b);
  if (plates.length === 0) return <span className={styles.none}>Nothing loaded</span>;
  return (
    <span className={styles.plates}>
      {plates.map((plate) => (
        <span key={plate} className={chipStyles.strip}>
          <span className={styles.plateLabel}>P{plate}</span>
          {WELL_LETTERS.map((letter) => {
            const here = wells.filter((w) => w.plate_index === plate && w.well.startsWith(letter));
            if (here.length === 0) {
              return (
                <span key={letter} className={chipStyles.empty} title={`Plate ${plate} ${letter}01 - nothing loaded`}>
                  {letter}
                </span>
              );
            }
            return here.map((w) => {
              const label = describeWell(w);
              return (
                <Link
                  key={w.cell_use_id}
                  to={`/cells/${w.cell_id}`}
                  state={linkState}
                  className={chipClass(USE_STATUS_TONE[w.status] ?? "default", matchedIds?.has(w.cell_use_id))}
                  title={label}
                  aria-label={label}
                  onClick={(e) => e.stopPropagation()}
                >
                  {letter}
                </Link>
              );
            });
          })}
        </span>
      ))}
    </span>
  );
}

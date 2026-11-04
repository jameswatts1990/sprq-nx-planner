import { Link } from "react-router-dom";

import { chipClass } from "@/components/shared/statusChip";
import type { SampleCellUseOut } from "@/types/sample";
import { formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { runLabel } from "@/utils/runLabel";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./SampleRunChips.module.css";

/** The full sentence a run chip's tooltip and screen-reader label carry. */
export function describeSampleUse(use: SampleCellUseOut): string {
  const run = runLabel({ run_id: use.run_batch_id, run_name: use.run_name });
  const where = [use.instrument_serial && `on ${use.instrument_serial}`, use.load_date && `loaded ${formatDateUTC(parseDateOnly(use.load_date))}`]
    .filter(Boolean)
    .join(", ");
  return [
    `Run ${run}${where ? ` ${where}` : ""}`,
    `${use.plate_number ? `Plate ${use.plate_number} ` : ""}well ${use.well}`,
    `cell ${use.cell_code}`,
    use.status === "cancelled" ? "blocked (cancelled)" : use.status,
  ].join(" · ");
}

export interface SampleRunChipsProps {
  uses: SampleCellUseOut[];
  /** Router state for each chip's link, so the run page's Back returns here. */
  linkState?: SampleDetailLocationState;
}

/** Where a sample has been: one chip per cell use - its run and well, coloured by how that use
 * went (grey planned, blue running, green completed, amber aborted, orange failed, red blocked) -
 * linking to the run. "Plate 2" uses read "P2 A01". */
export function SampleRunChips({ uses, linkState }: SampleRunChipsProps) {
  if (uses.length === 0) return <span className={styles.none}>Not placed yet</span>;
  return (
    <span className={styles.chips}>
      {uses.map((use) => {
        const label = describeSampleUse(use);
        return (
          <Link
            key={use.id}
            to={`/history/runs/${use.run_batch_id}`}
            state={linkState}
            className={chipClass(USE_STATUS_TONE[use.status] ?? "default")}
            title={label}
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.run}>{runLabel({ run_id: use.run_batch_id, run_name: use.run_name })}</span>
            <span className={styles.well}>
              {use.plate_number && use.plate_number > 1 ? `P${use.plate_number} ` : ""}
              {use.well}
            </span>
          </Link>
        );
      })}
    </span>
  );
}

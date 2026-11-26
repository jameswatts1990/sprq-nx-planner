import type { CellType } from "@/types/common";
import type { QcReviewWell } from "@/types/qcReview";
import { formatDateUTC, parseDateOnly, todayIsoUTC } from "@/utils/calendarDates";
import { ACQUISITIONS_PER_CELL } from "@/utils/creditCase";

import type { PacbioCasePrefill } from "./PacbioCaseModal";

/** "TRACTION-RUN-2589 · Plate 1 · A1" - how a QC Review well is named everywhere on the page. */
export function reviewWellLabel(well: QcReviewWell): string {
  return `${well.run_name} · Plate ${well.plate_number} · ${well.well_label}`;
}

/** The YYYY-MM-DD day of an MLWH timestamp (passed through as recorded, so no timezone shift). */
function mlwhDay(iso: string | null): string | null {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

/** "20 Nov 2026" for an MLWH timestamp, or null. */
export function mlwhDateLabel(iso: string | null): string | null {
  const day = mlwhDay(iso);
  return day ? formatDateUTC(parseDateOnly(day)) : null;
}

/** The reason the Cell QC dialog starts with when a fail is confirmed from QC Review - it becomes
 * the use's outcome note, so the RunNx record says where the verdict came from. */
export function reviewFailReason(well: QcReviewWell): string {
  const on = mlwhDateLabel(well.qc_date);
  return `QC Review: ${well.qc_state} (LangQC${on ? `, ${on}` : ""}) - ${reviewWellLabel(well)}`;
}

/** The well's cell type as MLWH records it: a single-use cell is SPRQ, anything else SPRQ-Nx. */
function reviewCellType(well: QcReviewWell): CellType {
  return well.is_multi_use === false ? "sprq" : "sprq_nx";
}

/** Acquisitions to claim, on the same basis RunNx uses for a cell's own case (utils/creditCase
 * expectedReimbursement): the failed use plus every use the cell could still have run. Null when
 * MLWH doesn't say which use of a multi-use cell this was. */
export function reviewExpectedAcquisitions(well: QcReviewWell): number | null {
  const cellType = reviewCellType(well);
  if (cellType === "sprq") return ACQUISITIONS_PER_CELL.sprq;
  if (well.cell_use_count == null) return null;
  return Math.max(1, ACQUISITIONS_PER_CELL.sprq_nx + 1 - well.cell_use_count);
}

/** A case without a cell, pre-filled from a QC Review well RunNx has no cell to fail for. */
export function reviewCasePrefill(well: QcReviewWell): PacbioCasePrefill {
  const where = reviewWellLabel(well);
  return {
    mlwhWellKey: well.key,
    context: `${well.qc_state} on ${where}`,
    summary: `${well.qc_state} (LangQC) - ${where}`.slice(0, 200),
    occurredOn: mlwhDay(well.well_complete) ?? mlwhDay(well.well_start) ?? mlwhDay(well.qc_date) ?? todayIsoUTC(),
    instrumentSerial: well.instrument_name,
    runName: well.run_name,
    poolId: well.library_barcodes.join(", ").slice(0, 120),
    cellType: reviewCellType(well),
    expectedAcquisitions: reviewExpectedAcquisitions(well),
  };
}

/** Does a QC Review well match the QC page's search box? Case-insensitive substring over the run,
 * plate/well, instrument, QC state, SMRT cell barcode, library tubes, and the matched RunNx cell
 * and Pool ID - the same kinds of thing the case search looks at. */
export function reviewWellMatches(well: QcReviewWell, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    reviewWellLabel(well),
    well.instrument_name,
    well.qc_state,
    well.smrt_cell_id,
    ...well.library_barcodes,
    well.match?.cell_code,
    well.match?.pool_id,
    well.match?.run_label,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(q);
}

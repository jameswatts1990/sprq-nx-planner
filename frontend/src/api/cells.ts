import { api, buildQuery } from "./client";
import type {
  CellBootstrapRequest,
  CellDetailOut,
  CellDiscardRequest,
  CellInternalReportRequest,
  CellOut,
  CellReportToPacbioRequest,
  TrayDiscardOut,
  TrayDiscardRequest,
  TrayRotateOut,
  TrayRotateRequest,
  TraySkipReuseOut,
  TraySkipReuseRequest,
} from "@/types/cell";
import type { Page } from "@/types/common";
import type { QcCommitOut, QcCommitRequest, QcPreviewOut, QcPreviewRequest, QcUndoOut } from "@/types/qc";

export interface ListCellsParams {
  status?: string;
  instrument_serial?: string;
  qc_status?: "unreported" | "awaiting_credit";
  q?: string;
  tray_id?: number;
  /** ISO datetime; when set, the API projects every time-derived field (uses, window, status)
   * to that instant instead of "now" - drives the Cells page Now / End-of-week toggle. */
  as_of?: string;
  page?: number;
  page_size?: number;
}

/** Follows pagination until every matching cell has been collected - for system-wide
 * reads (every open/stopped/terminal cell, for ghost rendering and the open-trays list)
 * where a fixed page_size would silently truncate to the N most-recently-created cells
 * as the total grows, dropping older still-relevant cells (e.g. an unused tray sibling)
 * with no visible sign anything was cut off. Not for CellsPage's browse UI, which keeps
 * real page/page_size controls since the user can see and page through its total. */
async function listAll(params: Omit<ListCellsParams, "page" | "page_size"> = {}): Promise<CellOut[]> {
  // Sized so a single request covers each status category's realistic lab-wide total (open /
  // stopped / terminal), keeping these system-wide reads to one round-trip each. The loop
  // below still handles the (rare) case of a category exceeding this, so nothing is ever
  // silently truncated - it just won't page for ordinary volumes.
  const page_size = 1000;
  const first = await cellsApi.list({ ...params, page: 1, page_size });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page++) {
    const next = await cellsApi.list({ ...params, page, page_size });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return items;
}

export const cellsApi = {
  list: (params: ListCellsParams = {}) => api.get<Page<CellOut>>(`/api/cells${buildQuery(params)}`),
  listAll,
  get: (id: number) => api.get<CellDetailOut>(`/api/cells/${id}`),
  bootstrap: (req: CellBootstrapRequest) => api.post<CellDetailOut>("/api/cells/bootstrap", req),
  /** Read-only: which samples a Fail / Fail-and-Stop / Retire would affect (failed,
   * displaced, reassigned) - drives the disposition step without mutating anything. */
  qcPreview: (id: number, req: QcPreviewRequest) => api.post<QcPreviewOut>(`/api/cells/${id}/qc/preview`, req),
  /** Atomically apply a QC verdict + per-sample dispositions: fail the triggering use,
   * re-zip the tray's loading queue, set the cell's terminal status, and route each
   * lost/displaced sample to a top-up or the backlog. */
  qcCommit: (id: number, req: QcCommitRequest) => api.post<QcCommitOut>(`/api/cells/${id}/qc/commit`, req),
  /** Reverse the most recent QC verdict on a cell - reopen it and restore the uses/samples
   * it touched (skipping any that have since drifted, e.g. a top-up already sent). */
  qcUndo: (id: number) => api.post<QcUndoOut>(`/api/cells/${id}/qc/undo`),
  /** Save the lab's internal-report link (e.g. a Google Sheet row / doc). The first save
   * stamps the internal-report timestamp, completing that stage of the credit workflow. */
  setInternalReport: (id: number, req: CellInternalReportRequest) =>
    api.post<CellOut>(`/api/cells/${id}/internal-report`, req),
  reportToPacbio: (id: number, req: CellReportToPacbioRequest) =>
    api.post<CellOut>(`/api/cells/${id}/report-to-pacbio`, req),
  confirmCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/confirm-credit`, {}),
  receiveCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/receive-credit`, {}),
  /** Force a single cell to "exhausted" regardless of its actual remaining use count. */
  discard: (id: number, req: CellDiscardRequest = {}) => api.post<CellOut>(`/api/cells/${id}/discard`, req),
  /** Force every physical cell in a tray to "exhausted" in one transaction - siblings
   * already retired/stopped/discarded are left untouched. */
  discardTray: (req: TrayDiscardRequest) => api.post<TrayDiscardOut>("/api/cells/discard-tray", req),
  /** Rotate a tray: mint a fresh tray in the same physical position and move this day's
   * uses (and every later use of the tray) onto it, restarting at Use 1; earlier uses stay
   * on the old (discarded) cells. 409 if a later run is confirmed loaded or a cell is
   * stopped/retired. */
  rotateTray: (req: TrayRotateRequest) => api.post<TrayRotateOut>("/api/cells/rotate-tray", req),
  /** Toggle a tray's reversible "skip reuse / planning disposal" flag. When on, autoschedule
   * and Recalculate stop offering any of the tray's cells for reuse; turning it off restores
   * reuse. Advisory - never changes cell status or cancels uses (unlike discardTray). */
  setTraySkipReuse: (req: TraySkipReuseRequest) =>
    api.post<TraySkipReuseOut>("/api/cells/skip-reuse-tray", req),
};

import { api, buildQuery } from "./client";
import type {
  CellBootstrapRequest,
  CellDetailOut,
  CellOut,
  CellReportToPacbioRequest,
  CellStopOut,
  CellStopRequest,
  CellUndoStopOut,
  TrayDiscardOut,
  TrayDiscardRequest,
  TrayRotateOut,
  TrayRotateRequest,
} from "@/types/cell";
import type { Page } from "@/types/common";

export interface ListCellsParams {
  status?: string;
  instrument_serial?: string;
  qc_status?: "unreported" | "awaiting_credit";
  q?: string;
  tray_id?: number;
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
  const page_size = 500;
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
  retire: (id: number) => api.post<CellOut>(`/api/cells/${id}/retire`),
  stop: (id: number, req: CellStopRequest) => api.post<CellStopOut>(`/api/cells/${id}/stop`, req),
  /** Reverse a mistaken Stop cell, reopening the cell and reviving every use it cancelled
   * back to "planned" - except one whose sample has since moved on (requeued/rescheduled
   * elsewhere), which stays cancelled to avoid double-booking that sample. */
  undoStop: (id: number) => api.post<CellUndoStopOut>(`/api/cells/${id}/undo-stop`),
  reportToPacbio: (id: number, req: CellReportToPacbioRequest) =>
    api.post<CellOut>(`/api/cells/${id}/report-to-pacbio`, req),
  confirmCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/confirm-credit`, {}),
  receiveCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/receive-credit`, {}),
  /** Force a single cell to "exhausted" regardless of its actual remaining use count. */
  discard: (id: number, req: CellStopRequest = {}) => api.post<CellOut>(`/api/cells/${id}/discard`, req),
  /** Force every physical cell in a tray to "exhausted" in one transaction - siblings
   * already retired/stopped/discarded are left untouched. */
  discardTray: (req: TrayDiscardRequest) => api.post<TrayDiscardOut>("/api/cells/discard-tray", req),
  /** Rotate a tray: mint a fresh tray in the same physical position and move this day's
   * uses (and every later use of the tray) onto it, restarting at Use 1; earlier uses stay
   * on the old (discarded) cells. 409 if a later run is confirmed loaded or a cell is
   * stopped/retired. */
  rotateTray: (req: TrayRotateRequest) => api.post<TrayRotateOut>("/api/cells/rotate-tray", req),
};

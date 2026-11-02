import type { ListCellTraysParams, TraySortKey } from "@/api/cells";
import type { CellStatus, CellType } from "@/types/common";
import { type ListView, type ListViewSpec, oneOf, readListFields, type SortDir, writeListView } from "@/utils/listView";

/** The Cells page's view - filters, search, sort, page and the as-of instant - kept in the URL
 * (see utils/listView), e.g. the Instruments page's /cells?instrument=84047&status=open. */

type QcFilter = "unreported" | "awaiting_credit";
export type StatusFilter = CellStatus | "all" | QcFilter;
/** Reference instant for every time-derived figure: now, or the end of this scheduling week. */
export type AsOf = "now" | "eow";

export interface CellsView extends ListView<TraySortKey> {
  status: StatusFilter;
  /** Instrument serial; "" = every instrument. */
  instrument: string;
  /** "" = both SPRQ-Nx and SPRQ. */
  chemistry: CellType | "";
  asOf: AsOf;
}

export const DEFAULT_CELLS_VIEW: CellsView = {
  status: "open",
  instrument: "",
  chemistry: "",
  q: "",
  sort: "expiry",
  dir: "asc",
  page: 1,
  pageSize: 50,
  asOf: "now",
};

/** Cell states a tray can be filtered on (a tray matches when any of its cells is in that state),
 * then the PacBio-credit stages, which cut across status. */
export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "exhausted", label: "Exhausted" },
  { value: "window_expired", label: "Window expired" },
  { value: "retired", label: "Retired" },
  { value: "stopped", label: "Stopped" },
];
export const QC_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "unreported", label: "QC: Unreported" },
  { value: "awaiting_credit", label: "QC: Awaiting credit" },
];

/** Soonest expiry and A→Z first, newest first for trays and dates, most uses left first. */
const SORT_DEFAULT_DIR: Record<TraySortKey, SortDir> = {
  expiry: "asc",
  tray: "desc",
  first_use: "desc",
  last_run: "desc",
  instrument: "asc",
  uses_left: "desc",
};

const STATUS_VALUES = [...STATUS_FILTERS, ...QC_FILTERS].map((f) => f.value);

export const CELLS_VIEW: ListViewSpec<CellsView> = {
  defaults: DEFAULT_CELLS_VIEW,
  // "status" and "instrument" are the names existing deep links use.
  keys: {
    status: "status",
    instrument: "instrument",
    chemistry: "chem",
    q: "q",
    sort: "sort",
    dir: "dir",
    page: "page",
    pageSize: "size",
    asOf: "asof",
  },
  sortDefaultDir: SORT_DEFAULT_DIR,
  read: (params) => {
    const d = DEFAULT_CELLS_VIEW;
    return {
      ...readListFields(params, CELLS_VIEW),
      status: oneOf(params.get("status"), STATUS_VALUES, d.status),
      instrument: params.get("instrument") ?? d.instrument,
      chemistry: oneOf(params.get("chem"), ["sprq", "sprq_nx"] as const, d.chemistry),
      asOf: params.get("asof") === "eow" ? "eow" : d.asOf,
    };
  },
};

export const readCellsView = CELLS_VIEW.read;

export function writeCellsView(prev: URLSearchParams, patch: Partial<CellsView>): URLSearchParams {
  return writeListView(CELLS_VIEW, prev, patch);
}

/** The listTrays request for a view at a resolved as-of instant. */
export function trayListParams(view: CellsView, asOfIso: string): ListCellTraysParams {
  const qc = view.status === "unreported" || view.status === "awaiting_credit";
  return {
    status: view.status === "all" || qc ? undefined : view.status,
    qc_status: qc ? (view.status as QcFilter) : undefined,
    instrument_serial: view.instrument || undefined,
    cell_type: view.chemistry || undefined,
    q: view.q || undefined,
    as_of: asOfIso,
    sort_by: view.sort,
    sort_dir: view.dir,
    page: view.page,
    page_size: view.pageSize,
  };
}

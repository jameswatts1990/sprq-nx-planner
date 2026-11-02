import type { ListCellTraysParams, TraySortKey } from "@/api/cells";
import type { CellStatus, CellType } from "@/types/common";

/** The Cells page's view - filters, search, sort, page and the as-of instant - kept in the URL so
 * Back from a cell, sample or tray returns to exactly this list, and a filtered view can be linked
 * to (e.g. the Instruments page's /cells?instrument=84047&status=open). */

type QcFilter = "unreported" | "awaiting_credit";
export type StatusFilter = CellStatus | "all" | QcFilter;
/** Reference instant for every time-derived figure: now, or the end of this scheduling week. */
export type AsOf = "now" | "eow";
export type SortDir = "asc" | "desc";

export interface CellsView {
  status: StatusFilter;
  /** Instrument serial; "" = every instrument. */
  instrument: string;
  /** "" = both SPRQ-Nx and SPRQ. */
  chemistry: CellType | "";
  q: string;
  sort: TraySortKey;
  dir: SortDir;
  page: number;
  pageSize: number;
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

export const PAGE_SIZES = [25, 50, 100, 200];

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

/** The direction that reads most naturally when a column is first picked: soonest expiry and
 * A→Z first, newest first for trays and dates, most uses left first. Clicking again flips it. */
export const SORT_DEFAULT_DIR: Record<TraySortKey, SortDir> = {
  expiry: "asc",
  tray: "desc",
  first_use: "desc",
  last_run: "desc",
  instrument: "asc",
  uses_left: "desc",
};

const STATUS_VALUES = new Set<string>([...STATUS_FILTERS, ...QC_FILTERS].map((f) => f.value));
const SORT_VALUES = new Set<string>(Object.keys(SORT_DEFAULT_DIR));

/** URL key for each view field. "status" and "instrument" are the names existing deep links use. */
const KEYS: Record<keyof CellsView, string> = {
  status: "status",
  instrument: "instrument",
  chemistry: "chem",
  q: "q",
  sort: "sort",
  dir: "dir",
  page: "page",
  pageSize: "size",
  asOf: "asof",
};

function positiveInt(raw: string | null): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/** The view a URL describes - anything missing or unrecognised falls back to the default. */
export function readCellsView(params: URLSearchParams): CellsView {
  const d = DEFAULT_CELLS_VIEW;
  const get = (key: keyof CellsView) => params.get(KEYS[key]);
  const status = get("status");
  const chemistry = get("chemistry");
  const sort = get("sort");
  const dir = get("dir");
  const size = positiveInt(get("pageSize"));
  return {
    status: status && STATUS_VALUES.has(status) ? (status as StatusFilter) : d.status,
    instrument: get("instrument") ?? d.instrument,
    chemistry: chemistry === "sprq" || chemistry === "sprq_nx" ? chemistry : d.chemistry,
    q: get("q") ?? d.q,
    sort: sort && SORT_VALUES.has(sort) ? (sort as TraySortKey) : d.sort,
    dir: dir === "asc" || dir === "desc" ? dir : d.dir,
    page: positiveInt(get("page")) ?? d.page,
    pageSize: size && PAGE_SIZES.includes(size) ? size : d.pageSize,
    asOf: get("asOf") === "eow" ? "eow" : d.asOf,
  };
}

/** `prev` with `patch` applied - defaults are left out of the URL so it stays short. Changing
 * anything but the page sends the list back to page 1. Unrelated params are kept. */
export function writeCellsView(prev: URLSearchParams, patch: Partial<CellsView>): URLSearchParams {
  const current = readCellsView(prev);
  const next = new URLSearchParams(prev);
  const merged: CellsView = { ...current, ...patch };
  const filterChanged = (Object.keys(patch) as (keyof CellsView)[]).some(
    (k) => k !== "page" && patch[k] !== current[k],
  );
  if (filterChanged && !("page" in patch)) merged.page = 1;
  for (const k of Object.keys(KEYS) as (keyof CellsView)[]) {
    const value = merged[k];
    if (value === DEFAULT_CELLS_VIEW[k]) next.delete(KEYS[k]);
    else next.set(KEYS[k], String(value));
  }
  return next;
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

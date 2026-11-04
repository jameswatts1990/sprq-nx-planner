import type { ListRunHistoryParams, RunHistorySortKey } from "@/api/cycles";
import type { CellType, CycleStatus } from "@/types/common";
import { type ListView, type ListViewSpec, oneOf, readListFields, type SortDir } from "@/utils/listView";

/** The Run history page's view - filters, load-date range, search, sort and page - kept in the
 * URL (see utils/listView). */

export type RunStatusFilter = CycleStatus | "all";

export interface RunsView extends ListView<RunHistorySortKey> {
  status: RunStatusFilter;
  /** Instrument serial; "" = every instrument. */
  instrument: string;
  /** "" = both SPRQ-Nx and SPRQ. */
  chemistry: CellType | "";
  /** Load-date range, YYYY-MM-DD; "" = open-ended. */
  from: string;
  to: string;
}

export const DEFAULT_RUNS_VIEW: RunsView = {
  status: "all",
  instrument: "",
  chemistry: "",
  from: "",
  to: "",
  q: "",
  sort: "load_date",
  dir: "desc",
  page: 1,
  pageSize: 50,
};

export const RUN_STATUS_FILTERS: { value: RunStatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "planned", label: "Planned" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "aborted", label: "Aborted" },
];

/** Newest runs first, instruments A→Z. */
const SORT_DEFAULT_DIR: Record<RunHistorySortKey, SortDir> = {
  load_date: "desc",
  run: "desc",
  instrument: "asc",
};

const isoDate = (raw: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "");

export const RUNS_VIEW: ListViewSpec<RunsView> = {
  defaults: DEFAULT_RUNS_VIEW,
  keys: {
    status: "status",
    instrument: "instrument",
    chemistry: "chem",
    from: "from",
    to: "to",
    q: "q",
    sort: "sort",
    dir: "dir",
    page: "page",
    pageSize: "size",
  },
  sortDefaultDir: SORT_DEFAULT_DIR,
  read: (params) => {
    const d = DEFAULT_RUNS_VIEW;
    return {
      ...readListFields(params, RUNS_VIEW),
      status: oneOf(
        params.get("status"),
        RUN_STATUS_FILTERS.map((f) => f.value),
        d.status,
      ),
      instrument: params.get("instrument") ?? d.instrument,
      chemistry: oneOf(params.get("chem"), ["sprq", "sprq_nx"] as const, d.chemistry),
      from: isoDate(params.get("from")),
      to: isoDate(params.get("to")),
    };
  },
};

/** The listHistory request for a view. */
export function runHistoryParams(view: RunsView): ListRunHistoryParams {
  return {
    status: view.status === "all" ? undefined : view.status,
    instrument_serial: view.instrument || undefined,
    cell_type: view.chemistry || undefined,
    date_from: view.from || undefined,
    date_to: view.to || undefined,
    q: view.q || undefined,
    sort_by: view.sort,
    sort_dir: view.dir,
    page: view.page,
    page_size: view.pageSize,
  };
}

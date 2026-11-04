import type { ListSamplesParams, SampleSortBy } from "@/api/samples";
import { SAMPLE_STATUSES, type SampleStatus } from "@/types/common";
import { type ListView, type ListViewSpec, oneOf, readListFields, type SortDir } from "@/utils/listView";
import { SAMPLE_STATUS_LABEL } from "@/utils/sampleStatus";

/** The Samples page's view - status and priority filters, search, sort and page - kept in the
 * URL (see utils/listView). */

/** "finished" = completed or failed (the page's old default view). */
export type SampleStatusFilter = SampleStatus | "all" | "finished";
/** The columns the Samples table sorts on. */
export type SampleListSortKey = Extract<
  SampleSortBy,
  "pool_id" | "status" | "barcode" | "plate_id" | "target_oplc" | "actual_oplc" | "priority" | "updated_at"
>;

export interface SamplesView extends ListView<SampleListSortKey> {
  status: SampleStatusFilter;
  /** "" = every priority. */
  priority: string;
}

export const DEFAULT_SAMPLES_VIEW: SamplesView = {
  status: "all",
  priority: "",
  q: "",
  sort: "updated_at",
  dir: "desc",
  page: 1,
  pageSize: 50,
};

export const SAMPLE_STATUS_FILTERS: { value: SampleStatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  ...SAMPLE_STATUSES.map((s) => ({ value: s, label: SAMPLE_STATUS_LABEL[s] })),
  { value: "finished", label: "Finished (completed or failed)" },
];

/** Most recently updated first; everything else A→Z / lowest first, priority highest first. */
const SORT_DEFAULT_DIR: Record<SampleListSortKey, SortDir> = {
  pool_id: "asc",
  status: "asc",
  barcode: "asc",
  plate_id: "asc",
  target_oplc: "asc",
  actual_oplc: "asc",
  priority: "asc",
  updated_at: "desc",
};

export const SAMPLES_VIEW: ListViewSpec<SamplesView> = {
  defaults: DEFAULT_SAMPLES_VIEW,
  keys: {
    status: "status",
    priority: "priority",
    q: "q",
    sort: "sort",
    dir: "dir",
    page: "page",
    pageSize: "size",
  },
  sortDefaultDir: SORT_DEFAULT_DIR,
  read: (params) => ({
    ...readListFields(params, SAMPLES_VIEW),
    status: oneOf(
      params.get("status"),
      SAMPLE_STATUS_FILTERS.map((f) => f.value),
      DEFAULT_SAMPLES_VIEW.status,
    ),
    priority: params.get("priority") ?? DEFAULT_SAMPLES_VIEW.priority,
  }),
};

/** The listHistory request for a view. */
export function sampleHistoryParams(view: SamplesView): Omit<ListSamplesParams, "qc_disposition"> {
  return {
    status: view.status === "all" ? undefined : view.status === "finished" ? "completed,failed" : view.status,
    priority: view.priority || undefined,
    q: view.q || undefined,
    sort_by: view.sort,
    sort_dir: view.dir,
    page: view.page,
    page_size: view.pageSize,
  };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { Table } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { topupsApi } from "@/api/topups";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import type { SampleOut } from "@/types/sample";
import type { SampleTopupOut } from "@/types/topup";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { ABORTED_PRIORITY, priorityLabel, priorityRank, priorityTone } from "@/utils/priority";
import { useClientSort } from "@/utils/useClientSort";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import { SampleModal } from "./SampleModal";
import styles from "./BacklogPage.module.css";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS: SegmentedOption<number>[] = [25, 50, 100, 200].map((n) => ({
  value: n,
  label: String(n),
}));
/** The QC-disposition tags whose samples show in the "Recoverable Samples" section. */
const RECOVERABLE_TAGS = "repeatable,recoverable";
const columnHelper = createColumnHelper<SampleOut>();

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** One value-per-sortable-column, used by the client-sorted Recoverable table (which is
 * fully loaded, so it sorts in the browser). Priority sorts by rank — not the raw label —
 * so it matches the server-sorted main backlog. Keys mirror the backend's SampleSortBy. */
const SAMPLE_SORT_ACCESSORS: Record<SampleSortBy, (s: SampleOut) => string | number | null> = {
  created_at: (s) => s.created_at,
  updated_at: (s) => s.updated_at,
  external_id: (s) => s.external_id,
  barcode: (s) => s.barcodes[0] ?? null,
  priority: (s) => priorityRank(s.priority),
  status: (s) => s.status,
  parent_sample: (s) => s.parent_sample,
  sanger_ids: (s) => s.sanger_ids[0] ?? null,
  target_oplc: (s) => s.target_oplc,
  volume: (s) => s.volume,
  adaptive_loading: (s) => s.adaptive_loading,
  full_resolution_base_q: (s) => s.full_resolution_base_q,
  ccs_kinetics: (s) => s.ccs_kinetics,
};

/** Column keys for the client-sorted Top-up table (fully loaded, no pagination). */
type TopupSortKey = "container" | "barcode" | "from" | "requested";
const TOPUP_SORT_ACCESSORS: Record<TopupSortKey, (t: SampleTopupOut) => string | number | null> = {
  container: (t) => t.external_id ?? `Sample ${t.sample_id}`,
  barcode: (t) => t.barcodes[0] ?? null,
  from: (t) => t.source_run_name ?? null,
  requested: (t) => t.request_sent_at ?? null,
};

interface SampleColumnDeps {
  /** Renders a clickable, sort-aware column header. The main backlog passes a server-sort
   * renderer; the Recoverable table passes a client-sort one, so each table sorts itself. */
  renderHeader: (label: string, field: SampleSortBy) => ReactNode;
  backNav: ReturnType<typeof useSampleBackNav>;
  onEdit: (sample: SampleOut) => void;
  onCancel: (id: number) => void;
  cancelPending: boolean;
}

/** The backlog sample table columns, parameterised by the header renderer so the main and
 * Recoverable tables can share cell markup while driving their own independent sort state. */
function buildSampleColumns({ renderHeader, backNav, onEdit, onCancel, cancelPending }: SampleColumnDeps) {
  return [
    columnHelper.accessor("external_id", {
      header: () => renderHeader("Container ID", "external_id"),
      cell: (info) => (
        <Link to={`/samples/${info.row.original.id}`} state={backNav} className="link">
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("barcodes", {
      header: () => renderHeader("Barcodes", "barcode"),
      cell: (info) => <BarcodeChips barcodes={info.getValue()} />,
    }),
    columnHelper.accessor("parent_sample", {
      header: () => renderHeader("Parent sample", "parent_sample"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("sanger_ids", {
      header: () => renderHeader("Sanger IDs", "sanger_ids"),
      cell: (info) => (info.getValue().length ? info.getValue().join(", ") : "—"),
    }),
    columnHelper.accessor("priority", {
      header: () => renderHeader("Priority", "priority"),
      cell: (info) => {
        const v = info.getValue();
        return <Badge tone={priorityTone(v)}>{priorityLabel(v)}</Badge>;
      },
    }),
    columnHelper.accessor("target_oplc", {
      header: () => renderHeader("Target OPLC", "target_oplc"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("volume", {
      header: () => renderHeader("Volume", "volume"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("adaptive_loading", {
      header: () => renderHeader("Adaptive loading", "adaptive_loading"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("full_resolution_base_q", {
      header: () => renderHeader("Full res. base Q", "full_resolution_base_q"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("ccs_kinetics", {
      header: () => renderHeader("Include base kinetics", "ccs_kinetics"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("created_at", {
      header: () => renderHeader("Created", "created_at"),
      cell: (info) => formatDateTime(info.getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: (info) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => onEdit(info.row.original)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onCancel(info.row.original.id)} disabled={cancelPending}>
            Cancel
          </Button>
        </div>
      ),
    }),
  ];
}

/** Shared table markup for a react-table instance of backlog samples. */
function SampleTableView({ table }: { table: Table<SampleOut> }) {
  return (
    <table className={styles.table}>
      <thead>
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((h) => (
              <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BacklogPage() {
  const [qInput, setQInput] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SampleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [editSample, setEditSample] = useState<SampleOut | null>(null);
  const q = useDebouncedValue(qInput, 350);
  const queryClient = useQueryClient();

  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities", "backlog"],
    queryFn: () => samplesApi.listPriorities("backlog"),
  });

  // Main backlog EXCLUDES the QC-return (recoverable/repeatable) rows - they get their own
  // section above - via qc_disposition:"none".
  const query = useQuery({
    queryKey: ["samples", { status: "backlog", qc_disposition: "none", q, priority, sortBy, sortDir, page, page_size: pageSize }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        qc_disposition: "none",
        q: q || undefined,
        priority: priority || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
  });

  // Samples returned to the backlog by a Cell QC action (Repeatable/Recoverable) - shown as
  // a distinct band above the main backlog, already bumped above High by their rank-0 label.
  const recoverableQuery = useQuery({
    queryKey: ["samples", { status: "backlog", qc_disposition: RECOVERABLE_TAGS, page_size: 200 }],
    queryFn: () =>
      samplesApi.list({ status: "backlog", qc_disposition: RECOVERABLE_TAGS, sort_by: "priority", sort_dir: "asc", page: 1, page_size: 200 }),
  });
  const recoverableItems = recoverableQuery.data?.items ?? [];

  const topupsQuery = useQuery({ queryKey: ["topups"], queryFn: () => topupsApi.list() });
  const topups = topupsQuery.data ?? [];

  // Lightweight count-only check (page_size 1, just reading .total) for the warning badge.
  const abortedQuery = useQuery({
    queryKey: ["samples", { status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }],
    queryFn: () => samplesApi.list({ status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }),
  });
  const abortedCount = abortedQuery.data?.total ?? 0;

  const cancelMutation = useMutation({
    mutationFn: (id: number) => samplesApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
    },
  });

  const topupSentMutation = useMutation({
    mutationFn: (id: number) => topupsApi.requestSent(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["topups"] }),
  });
  const topupCancelMutation = useMutation({
    mutationFn: (id: number) => topupsApi.cancel(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["topups"] }),
  });

  const toggleSort = useCallback((field: SampleSortBy) => {
    setPage(1);
    setSortBy((cur) => {
      if (cur === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return cur;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  // Main backlog: server-side sort (spans every page), driven by the query params above.
  const sortableHeader = useCallback(
    (label: string, field: SampleSortBy) => (
      <SortableColumnHeader label={label} active={sortBy === field} dir={sortDir} onClick={() => toggleSort(field)} />
    ),
    [sortBy, sortDir, toggleSort],
  );

  // Recoverable band: fully loaded (no pagination), so it sorts in the browser and its
  // headers must NOT touch the main backlog's server sort.
  const recoverableSort = useClientSort(recoverableItems, SAMPLE_SORT_ACCESSORS, { by: "priority", dir: "asc" });
  // Destructure the stable pieces (sortBy/sortDir are primitives, toggle is memoized) so the
  // header renderer isn't rebuilt on every render just because useClientSort returns a fresh object.
  const { sortBy: recSortBy, sortDir: recSortDir, toggle: recToggle } = recoverableSort;
  const recoverableHeader = useCallback(
    (label: string, field: SampleSortBy) => (
      <SortableColumnHeader
        label={label}
        active={recSortBy === field}
        dir={recSortDir}
        onClick={() => recToggle(field)}
      />
    ),
    [recSortBy, recSortDir, recToggle],
  );

  // Top-up list is fully loaded too, so it sorts client-side like the Recoverable band.
  const topupSort = useClientSort(topups, TOPUP_SORT_ACCESSORS, { by: "container", dir: "asc" });

  const { mutate: cancelSample, isPending: cancelPending } = cancelMutation;
  const backNav = useSampleBackNav();

  const columns = useMemo(
    () =>
      buildSampleColumns({
        renderHeader: sortableHeader,
        backNav,
        onEdit: setEditSample,
        onCancel: cancelSample,
        cancelPending,
      }),
    [sortableHeader, cancelSample, cancelPending, backNav],
  );
  const recoverableColumns = useMemo(
    () =>
      buildSampleColumns({
        renderHeader: recoverableHeader,
        backNav,
        onEdit: setEditSample,
        onCancel: cancelSample,
        cancelPending,
      }),
    [recoverableHeader, cancelSample, cancelPending, backNav],
  );

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });
  const recoverableTable = useReactTable({
    data: recoverableSort.sorted,
    columns: recoverableColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.page}>
      {recoverableItems.length > 0 && (
        <Card>
          <CardHeader badge={<Badge tone="info">{recoverableItems.length} recoverable</Badge>}>
            <h2>Recoverable Samples</h2>
          </CardHeader>
          <CardBody>
            <p className={styles.sectionHint}>
              Samples returned to the backlog by a Cell QC action — bumped above High priority. Reschedule them from
              the grid like any backlog sample.
            </p>
            <SampleTableView table={recoverableTable} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          badge={
            <span className={styles.badgeGroup}>
              {abortedCount > 0 && <Badge tone="danger">⚠ {abortedCount} aborted</Badge>}
              {recoverableItems.length > 0 && <Badge tone="info">{recoverableItems.length} recoverable</Badge>}
              {`${total} sample${total === 1 ? "" : "s"}`}
            </span>
          }
        >
          <h2>Backlog</h2>
        </CardHeader>
        <CardBody>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search by container ID, barcode, parent sample, or priority…"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
            />
            <select
              className={styles.select}
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All priorities</option>
              {(prioritiesQuery.data ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <SegmentedControl
              ariaLabel="Rows per page"
              options={PAGE_SIZE_OPTIONS}
              value={pageSize}
              onChange={(v) => {
                setPageSize(v);
                setPage(1);
              }}
            />
            <div className={styles.spacer} />
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
              + Add sample
            </Button>
          </div>

          {query.isLoading && <div className={styles.status}>Loading backlog…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load backlog."}
            </Note>
          )}
          {cancelMutation.isError && (
            <Note tone="bad" icon="!">
              {cancelMutation.error instanceof ApiError ? cancelMutation.error.message : "Failed to cancel sample."}
            </Note>
          )}

          {!query.isLoading && !query.isError && items.length === 0 && (
            <div className={styles.status}>No backlog samples found.</div>
          )}

          {!query.isLoading && !query.isError && items.length > 0 && (
            <>
              <SampleTableView table={table} />
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardBody>
      </Card>

      {topups.length > 0 && (
        <Card>
          <CardHeader badge={<Badge tone="warning">{topups.length} top-up{topups.length === 1 ? "" : "s"}</Badge>}>
            <h2>Top-up required</h2>
          </CardHeader>
          <CardBody>
            <p className={styles.sectionHint}>
              Samples lost to a Cell QC action that need fresh material. Confirm when the top-up request has been sent,
              or cancel to remove it from this list.
            </p>
            {topupCancelMutation.isError && (
              <Note tone="bad" icon="!">Failed to cancel the top-up.</Note>
            )}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <SortableColumnHeader
                      label="Container ID"
                      active={topupSort.sortBy === "container"}
                      dir={topupSort.sortDir}
                      onClick={() => topupSort.toggle("container")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Barcodes"
                      active={topupSort.sortBy === "barcode"}
                      dir={topupSort.sortDir}
                      onClick={() => topupSort.toggle("barcode")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="From"
                      active={topupSort.sortBy === "from"}
                      dir={topupSort.sortDir}
                      onClick={() => topupSort.toggle("from")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Requested"
                      active={topupSort.sortBy === "requested"}
                      dir={topupSort.sortDir}
                      onClick={() => topupSort.toggle("requested")}
                    />
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {topupSort.sorted.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.external_id ? <b>{t.external_id}</b> : `Sample ${t.sample_id}`}
                    </td>
                    <td>
                      <BarcodeChips barcodes={t.barcodes} />
                    </td>
                    <td>
                      {t.source_run_name ?? "—"}
                      {t.source_cell_code ? ` · ${t.source_cell_code}` : ""}
                    </td>
                    <td>{t.request_sent_at ? new Date(t.request_sent_at).toLocaleDateString() : "—"}</td>
                    <td>
                      <div className={styles.rowActions}>
                        {!t.request_sent_at && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => topupSentMutation.mutate(t.id)}
                            disabled={topupSentMutation.isPending}
                          >
                            Request Sent
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => topupCancelMutation.mutate(t.id)}
                          disabled={topupCancelMutation.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {addOpen && <SampleModal onClose={() => setAddOpen(false)} />}
      {editSample && <SampleModal sample={editSample} onClose={() => setEditSample(null)} />}
    </div>
  );
}

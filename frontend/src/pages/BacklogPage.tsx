import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { Table } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { topupsApi } from "@/api/topups";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { ComplexCountdownChip } from "@/components/shared/ComplexCountdownChip";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { Pagination } from "@/components/shared/Pagination";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { UnitLabel } from "@/components/shared/UnitLabel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import type { SampleOut } from "@/types/sample";
import type { SampleTopupOut } from "@/types/topup";
import { formatDateTime } from "@/utils/calendarDates";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { ABORTED_PRIORITY, priorityLabel, priorityRank, priorityTone } from "@/utils/priority";
import { qcDispositionDescription, qcDispositionLabel } from "@/utils/qcDisposition";
import { useClientSort } from "@/utils/useClientSort";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import { SampleModal } from "./SampleModal";
import styles from "./BacklogPage.module.css";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS: SegmentedOption<number>[] = [25, 50, 100, 200].map((n) => ({
  value: n,
  label: String(n),
}));
/** The QC-disposition tags whose samples show in the "Recoverable Samples" section (both repeat
 * pathways — from complex and from library — plus data-recoverable). */
const RECOVERABLE_TAGS = "repeatable_complex,repeatable,recoverable";
const columnHelper = createColumnHelper<SampleOut>();

/** One value-per-sortable-column, used by the client-sorted Recoverable table (which is
 * fully loaded, so it sorts in the browser). Priority sorts by rank — not the raw label —
 * so it matches the server-sorted main backlog. Keys mirror the backend's SampleSortBy. */
const SAMPLE_SORT_ACCESSORS: Record<SampleSortBy, (s: SampleOut) => string | number | null> = {
  created_at: (s) => s.created_at,
  updated_at: (s) => s.updated_at,
  pool_id: (s) => s.pool_id,
  barcode: (s) => s.barcodes[0] ?? null,
  priority: (s) => priorityRank(s.priority),
  status: (s) => s.status,
  plate_id: (s) => s.plate_id,
  sanger_ids: (s) => s.sanger_ids[0] ?? null,
  target_oplc: (s) => s.target_oplc,
  actual_oplc: (s) => s.actual_oplc,
  adaptive_loading: (s) => s.adaptive_loading,
  full_resolution_base_q: (s) => s.full_resolution_base_q,
  base_kinetics: (s) => s.base_kinetics,
};

/** Column keys for the client-sorted Resupply requests table (pending only, fully loaded, no pagination). */
type ResupplySortKey = "container" | "sanger" | "barcode" | "from" | "raised";
const RESUPPLY_SORT_ACCESSORS: Record<ResupplySortKey, (t: SampleTopupOut) => string | number | null> = {
  container: (t) => t.pool_id ?? `Sample ${t.sample_id}`,
  sanger: (t) => t.sanger_ids[0] ?? null,
  barcode: (t) => t.barcodes[0] ?? null,
  from: (t) => t.source_run_name ?? null,
  raised: (t) => t.created_at,
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
    columnHelper.accessor("pool_id", {
      header: () => renderHeader("Pool ID", "pool_id"),
      cell: (info) => (
        <span className={styles.badgeGroup}>
          <Link to={`/samples/${info.row.original.id}`} state={backNav} className="link">
            {info.getValue()}
          </Link>
          <DuplicateBadge
            index={info.row.original.duplicate_index}
            total={info.row.original.duplicate_total}
          />
        </span>
      ),
    }),
    columnHelper.accessor("barcodes", {
      header: () => renderHeader("Barcodes", "barcode"),
      cell: (info) => <BarcodeChips barcodes={info.getValue()} />,
    }),
    columnHelper.accessor("plate_id", {
      header: () => renderHeader("Plate ID", "plate_id"),
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
        // For a QC-return row (Recoverable Samples section) show which repeat pathway was chosen
        // — "Repeatable — from complex" vs "from library" both carry the rank-0 Repeatable badge,
        // so the priority label alone can't tell them apart. Main-backlog rows have no
        // qc_disposition, so they keep the plain priority label.
        const { qc_disposition, qc_disposition_at } = info.row.original;
        const disp = qcDispositionLabel(qc_disposition);
        return (
          <span className={styles.badgeGroup}>
            <Badge tone={priorityTone(v)} title={qcDispositionDescription(qc_disposition)}>
              {disp ?? priorityLabel(v)}
            </Badge>
            <ComplexCountdownChip qcDisposition={qc_disposition} qcDispositionAt={qc_disposition_at} />
          </span>
        );
      },
    }),
    columnHelper.accessor("target_oplc", {
      header: () => renderHeader("Target OPLC", "target_oplc"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("actual_oplc", {
      header: () => renderHeader("Actual OPLC", "actual_oplc"),
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
    columnHelper.accessor("base_kinetics", {
      header: () => renderHeader("Include base kinetics", "base_kinetics"),
      cell: (info) => info.getValue() ?? "—",
    }),
    columnHelper.accessor("insert_size_bp", {
      header: () => <UnitLabel text="Insert size (bp)" />,
      cell: (info) => {
        const v = info.getValue();
        return v != null ? v.toLocaleString() : "—";
      },
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
    <table className="table">
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
  // Defaults to priority order (High first, ascending rank - see utils/priority.ts) rather
  // than created_at, so the most urgent backlog samples surface without the user having to
  // sort themselves; matches the Recoverable Samples section's default (useClientSort below).
  const [sortBy, setSortBy] = useState<SampleSortBy>("priority");
  const [sortDir, setSortDir] = useState<SampleSortDir>("asc");
  const [addOpen, setAddOpen] = useState(false);
  const [editSample, setEditSample] = useState<SampleOut | null>(null);
  const [confirmSent, setConfirmSent] = useState<SampleTopupOut | null>(null);
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

  // Pending only - a request marked sent drops off here and lives on the sample's detail page.
  const resupplyQuery = useQuery({
    queryKey: ["topups", { status: "pending" }],
    queryFn: () => topupsApi.list({ status: "pending" }),
  });
  const resupplies = resupplyQuery.data ?? [];

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

  const resupplySentMutation = useMutation({
    mutationFn: (id: number) => topupsApi.requestSent(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["topups"] }),
  });
  const resupplyCancelMutation = useMutation({
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

  // The resupply list is fully loaded too, so it sorts client-side like the Recoverable band.
  const resupplySort = useClientSort(resupplies, RESUPPLY_SORT_ACCESSORS, { by: "container", dir: "asc" });

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
  // The live count under the page title. It's the main list's total, so it follows the search /
  // priority filter - say so rather than passing a filtered count off as the whole backlog.
  const filtered = q !== "" || priority !== "";
  const backlogSummary = !query.data
    ? "Samples waiting to be scheduled"
    : filtered
      ? `${total} sample${total === 1 ? " matches" : "s match"} the current filter`
      : `${total} sample${total === 1 ? "" : "s"} waiting to be scheduled`;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Backlog"
        intro={backlogSummary}
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            + Add sample
          </Button>
        }
      />

      {recoverableItems.length > 0 && (
        <Card>
          <CardHeader badge={<Badge tone="info">{recoverableItems.length} recoverable</Badge>}>
            <h2>Recoverable Samples</h2>
          </CardHeader>
          <CardBody>
            <p className={styles.sectionHint}>
              Samples returned to the backlog by a Cell QC action — bumped above High priority. Hover a priority to see
              what that outcome means; a ⌛ chip counts down the 30 days to use leftover complex. Reschedule them from
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
            </span>
          }
        >
          <h2>Samples to schedule</h2>
        </CardHeader>
        <CardBody>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search by Pool ID, Sanger ID, barcode, Plate ID, or priority…"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
            />
            <select
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
          </div>

          {query.isLoading && <div className="status">Loading backlog…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the backlog.")}
            </Note>
          )}
          {cancelMutation.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(cancelMutation.error, "Couldn't cancel the sample.")}
            </Note>
          )}

          {!query.isLoading && !query.isError && items.length === 0 && (
            <div className="status">No backlog samples found.</div>
          )}

          {!query.isLoading && !query.isError && items.length > 0 && (
            <>
              <SampleTableView table={table} />
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardBody>
      </Card>

      {resupplies.length > 0 && (
        <Card>
          <CardHeader
            badge={
              <Badge tone="warning">
                {resupplies.length} resupply request{resupplies.length === 1 ? "" : "s"}
              </Badge>
            }
          >
            <h2>Resupply requests</h2>
          </CardHeader>
          <CardBody>
            <p className={styles.sectionHint}>
              Samples dispositioned <b>Lost</b> in a Cell QC action — there is no material left, so fresh sample is
              needed from the supplier. Press <b>Request sent</b> once you&apos;ve emailed the supplier; the request then
              leaves this list and stays on the sample&apos;s own page. <b>Cancel</b> removes a request that isn&apos;t
              needed.
            </p>
            {(resupplyCancelMutation.isError || resupplySentMutation.isError) && (
              <Note tone="bad" icon="!">
                {resupplyCancelMutation.isError
                  ? errorMessage(resupplyCancelMutation.error, "Couldn't cancel the resupply request.")
                  : errorMessage(resupplySentMutation.error, "Couldn't mark the resupply request as sent.")}
              </Note>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <SortableColumnHeader
                      label="Pool ID"
                      active={resupplySort.sortBy === "container"}
                      dir={resupplySort.sortDir}
                      onClick={() => resupplySort.toggle("container")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Sanger IDs"
                      active={resupplySort.sortBy === "sanger"}
                      dir={resupplySort.sortDir}
                      onClick={() => resupplySort.toggle("sanger")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Barcodes"
                      active={resupplySort.sortBy === "barcode"}
                      dir={resupplySort.sortDir}
                      onClick={() => resupplySort.toggle("barcode")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="From"
                      active={resupplySort.sortBy === "from"}
                      dir={resupplySort.sortDir}
                      onClick={() => resupplySort.toggle("from")}
                    />
                  </th>
                  <th>
                    <SortableColumnHeader
                      label="Raised"
                      active={resupplySort.sortBy === "raised"}
                      dir={resupplySort.sortDir}
                      onClick={() => resupplySort.toggle("raised")}
                    />
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resupplySort.sorted.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/samples/${t.sample_id}`} state={backNav} className="link">
                        <b>{t.pool_id ?? `Sample ${t.sample_id}`}</b>
                      </Link>
                    </td>
                    <td>{t.sanger_ids.length ? t.sanger_ids.join(", ") : "—"}</td>
                    <td>
                      <BarcodeChips barcodes={t.barcodes} />
                    </td>
                    <td>
                      {t.source_run_name ?? "—"}
                      {t.source_cell_code ? ` · ${t.source_cell_code}` : ""}
                    </td>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setConfirmSent(t)}
                          disabled={resupplySentMutation.isPending}
                        >
                          Request sent
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resupplyCancelMutation.mutate(t.id)}
                          disabled={resupplyCancelMutation.isPending}
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

      {confirmSent && (
        <ConfirmModal
          title="Confirm resupply request sent"
          confirmLabel="Request sent"
          pendingLabel="Saving…"
          pending={resupplySentMutation.isPending}
          onCancel={() => setConfirmSent(null)}
          onConfirm={() => resupplySentMutation.mutate(confirmSent.id, { onSuccess: () => setConfirmSent(null) })}
        >
          <p>
            Confirm that you have emailed the supplier to resend additional sample for{" "}
            <b>{confirmSent.pool_id ?? `Sample ${confirmSent.sample_id}`}</b> before pressing <b>Request sent</b>.
          </p>
          <p className={styles.sectionHint}>
            This records today&apos;s date and removes it from this list — it stays visible on the sample&apos;s page.
          </p>
        </ConfirmModal>
      )}

      {addOpen && <SampleModal onClose={() => setAddOpen(false)} />}
      {editSample && <SampleModal sample={editSample} onClose={() => setEditSample(null)} />}
    </div>
  );
}

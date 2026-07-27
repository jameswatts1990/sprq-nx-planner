import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { Table } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { topupsApi } from "@/api/topups";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import type { SampleOut } from "@/types/sample";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { ABORTED_PRIORITY, priorityLabel, priorityTone } from "@/utils/priority";
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

function sortIndicator(active: boolean, dir: SampleSortDir): string {
  if (!active) return "";
  return dir === "asc" ? " ▲" : " ▼";
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

  const sortableHeader = useCallback(
    (label: string, field: SampleSortBy) => {
      const active = sortBy === field;
      return (
        <button type="button" className={styles.sortHeader} onClick={() => toggleSort(field)}>
          {label}
          {sortIndicator(active, sortDir)}
        </button>
      );
    },
    [sortBy, sortDir, toggleSort],
  );

  const { mutate: cancelSample, isPending: cancelPending } = cancelMutation;
  const backNav = useSampleBackNav();

  const columns = useMemo(
    () => [
      columnHelper.accessor("external_id", {
        header: () => sortableHeader("Container ID", "external_id"),
        cell: (info) => (
          <Link to={`/samples/${info.row.original.id}`} state={backNav} className="link">
            {info.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor("barcodes", {
        header: () => sortableHeader("Barcodes", "barcode"),
        cell: (info) => <BarcodeChips barcodes={info.getValue()} />,
      }),
      columnHelper.accessor("parent_sample", {
        header: "Parent sample",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("sanger_ids", {
        header: "Sanger IDs",
        cell: (info) => (info.getValue().length ? info.getValue().join(", ") : "—"),
      }),
      columnHelper.accessor("priority", {
        header: () => sortableHeader("Priority", "priority"),
        cell: (info) => {
          const v = info.getValue();
          return <Badge tone={priorityTone(v)}>{priorityLabel(v)}</Badge>;
        },
      }),
      columnHelper.accessor("target_oplc", {
        header: "Target OPLC",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("volume", {
        header: "Volume",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("adaptive_loading", {
        header: "Adaptive loading",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("full_resolution_base_q", {
        header: "Full res. base Q",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("ccs_kinetics", {
        header: "Include base kinetics",
        cell: (info) => info.getValue() ?? "—",
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: (info) => formatDateTime(info.getValue()),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className={styles.rowActions}>
            <Button size="sm" variant="ghost" onClick={() => setEditSample(info.row.original)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => cancelSample(info.row.original.id)}
              disabled={cancelPending}
            >
              Cancel
            </Button>
          </div>
        ),
      }),
    ],
    [sortableHeader, cancelSample, cancelPending, backNav],
  );

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });
  const recoverableTable = useReactTable({ data: recoverableItems, columns, getCoreRowModel: getCoreRowModel() });
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
                  <th>Container ID</th>
                  <th>Barcodes</th>
                  <th>From</th>
                  <th>Requested</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {topups.map((t) => (
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

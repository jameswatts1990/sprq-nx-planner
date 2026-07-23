import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useState } from "react";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
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
import { ABORTED_PRIORITY, priorityTone } from "@/utils/priority";

import { AddSampleModal } from "./AddSampleModal";
import styles from "./BacklogPage.module.css";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS: SegmentedOption<number>[] = [25, 50, 100, 200].map((n) => ({
  value: n,
  label: String(n),
}));
const columnHelper = createColumnHelper<SampleOut>();

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function sortIndicator(active: boolean, dir: SampleSortDir): string {
  if (!active) return "";
  return dir === "asc" ? " ▲" : " ▼";
}

export function BacklogPage() {
  const [qInput, setQInput] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SampleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const [addOpen, setAddOpen] = useState(false);
  const q = useDebouncedValue(qInput, 350);
  const queryClient = useQueryClient();

  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities"],
    queryFn: () => samplesApi.listPriorities(),
  });

  const query = useQuery({
    queryKey: ["samples", { status: "backlog", q, priority, sortBy, sortDir, page, page_size: pageSize }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        q: q || undefined,
        priority: priority || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
  });

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

  function toggleSort(field: SampleSortBy) {
    setPage(1);
    setSortBy((cur) => {
      if (cur === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return cur;
      }
      setSortDir("asc");
      return field;
    });
  }

  function sortableHeader(label: string, field: SampleSortBy) {
    const active = sortBy === field;
    return (
      <button type="button" className={styles.sortHeader} onClick={() => toggleSort(field)}>
        {label}
        {sortIndicator(active, sortDir)}
      </button>
    );
  }

  const columns = [
    columnHelper.accessor("external_id", { header: () => sortableHeader("Container ID", "external_id") }),
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
        return v ? <Badge tone={priorityTone(v)}>{v}</Badge> : "—";
      },
    }),
    columnHelper.accessor("target_oplc", {
      header: "Target OPLC",
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => cancelMutation.mutate(info.row.original.id)}
          disabled={cancelMutation.isPending}
        >
          Cancel
        </Button>
      ),
    }),
  ];

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader
          badge={
            <span className={styles.badgeGroup}>
              {abortedCount > 0 && <Badge tone="danger">⚠ {abortedCount} aborted</Badge>}
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

              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardBody>
      </Card>
      {addOpen && <AddSampleModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

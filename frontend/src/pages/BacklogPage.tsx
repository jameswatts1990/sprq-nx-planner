import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useState } from "react";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./BacklogPage.module.css";

const PAGE_SIZE = 25;
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
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SampleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const q = useDebouncedValue(qInput, 350);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["samples", { status: "backlog", q, sortBy, sortDir, page, page_size: PAGE_SIZE }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        q: q || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: PAGE_SIZE,
      }),
  });

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
    columnHelper.accessor("external_id", { header: () => sortableHeader("External ID", "external_id") }),
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
      cell: (info) => info.getValue() ?? "—",
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader badge={`${total} sample${total === 1 ? "" : "s"}`}>
          <h2>Backlog</h2>
        </CardHeader>
        <CardBody>
          <input
            type="search"
            className={styles.search}
            placeholder="Search by external ID, barcode, or parent sample…"
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              setPage(1);
            }}
          />

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

              <div className={styles.pagination}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span className={styles.pageInfo}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

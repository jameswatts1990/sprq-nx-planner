import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { adminApi } from "@/api/admin";
import { ApiError } from "@/api/client";
import { Pagination } from "@/components/shared/Pagination";
import { SortableColumnHeader, type SortDir } from "@/components/shared/SortableColumnHeader";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import { ClearTableModal } from "./ClearTableModal";
import { RowEditModal } from "./RowEditModal";
import styles from "./SettingsPage.module.css";

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface TableRowsPanelProps {
  table: string;
  /** Unfiltered row count (from the tables list) — what "Clear table" acts on, regardless of search. */
  rowCount: number;
}

/** Server-side search/sort/paging over one raw table. Render with `key={table}` so switching
 * tables resets page, search and sort (a sort column from one table won't exist in another). */
export function TableRowsPanel({ table, rowCount }: TableRowsPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [qInput, setQInput] = useState("");
  const [sort, setSort] = useState<string | null>(null);
  const [order, setOrder] = useState<SortDir>("asc");
  const [rowPendingDelete, setRowPendingDelete] = useState<string | null>(null);
  const [rowPendingEdit, setRowPendingEdit] = useState<Record<string, unknown> | null>(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const q = useDebouncedValue(qInput.trim(), 300);

  const query = useQuery({
    queryKey: ["admin", "rows", table, { page, pageSize, q, sort, order }],
    queryFn: () =>
      adminApi.listRows(table, { page, page_size: pageSize, q, sort: sort ?? undefined, order }),
    // Keep the current rows on screen while the next page/search/sort loads, instead of
    // flashing "Loading rows…" on every keystroke.
    placeholderData: keepPreviousData,
  });

  function toggleSort(column: string) {
    setPage(1);
    if (sort === column) {
      setOrder((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setOrder("asc");
    }
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "rows", table] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "tables"] });
  }

  const deleteMutation = useMutation({
    mutationFn: (rowId: string) => adminApi.deleteRow(table, rowId),
    onSuccess: () => {
      setRowPendingDelete(null);
      invalidate();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ rowId, values }: { rowId: string; values: Record<string, unknown> }) =>
      adminApi.updateRow(table, rowId, values),
    onSuccess: () => {
      setRowPendingEdit(null);
      invalidate();
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => adminApi.clearTable(table),
    onSuccess: () => {
      setClearModalOpen(false);
      setPage(1);
      invalidate();
    },
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const columns = data?.columns ?? [];
  const pkColumn = data?.primary_key[0];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(total, page * pageSize);
  const searching = q !== "";

  // A delete/clear (or a narrower search) can leave the current page past the end.
  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  return (
    <div>
      <div className={styles.panelHeader}>
        <h2>
          {table} <span className={styles.rowCount}>({rowCount} row{rowCount === 1 ? "" : "s"})</span>
        </h2>
        <Button variant="danger" onClick={() => setClearModalOpen(true)} disabled={rowCount === 0}>
          Clear table
        </Button>
      </div>

      {rowCount > 0 && (
        <div className={styles.rowsToolbar}>
          <input
            type="search"
            className={styles.rowsSearch}
            placeholder="Search all columns…"
            aria-label={`Search ${table}`}
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              setPage(1);
            }}
          />
          <span className={styles.pageInfo} aria-live="polite">
            {searching
              ? `${total} match${total === 1 ? "" : "es"}${total > 0 ? ` · showing ${firstShown}–${lastShown}` : ""}`
              : `Showing ${firstShown}–${lastShown} of ${total}`}
          </span>
          <label className={styles.pageSizeLabel}>
            Rows per page
            <select
              className={styles.pageSizeSelect}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {query.isLoading && <div className={styles.status}>Loading rows…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load rows."}
        </Note>
      )}
      {deleteMutation.isError && (
        <Note tone="bad" icon="!">
          {deleteMutation.error instanceof ApiError ? deleteMutation.error.message : "Failed to delete row."}
        </Note>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className={styles.status}>
          {searching ? <>No rows in {table} match &ldquo;{q}&rdquo;.</> : "This table has no rows."}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>
                      <SortableColumnHeader
                        label={c}
                        active={sort === c}
                        dir={order}
                        onClick={() => toggleSort(c)}
                      />
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const rowId = pkColumn ? String(row[pkColumn]) : String(i);
                  return (
                    <tr key={rowId}>
                      {columns.map((c) => (
                        <td key={c} className={styles.mono}>
                          {formatCellValue(row[c])}
                        </td>
                      ))}
                      <td className={styles.rowActions}>
                        {pkColumn && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                editMutation.reset();
                                setRowPendingEdit(row);
                              }}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRowPendingDelete(rowId)}>
                              Delete
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}

      {rowPendingDelete !== null && (
        <Modal onClose={() => setRowPendingDelete(null)} title="Delete this row?">
          <p className={styles.helper}>
            This permanently deletes the row with {pkColumn} = <b>{rowPendingDelete}</b> from <b>{table}</b>. This
            can&apos;t be undone.
          </p>
          <ModalActions>
            <Button variant="ghost" onClick={() => setRowPendingDelete(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteMutation.mutate(rowPendingDelete)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete row"}
            </Button>
          </ModalActions>
        </Modal>
      )}

      {rowPendingEdit !== null && pkColumn && (
        <RowEditModal
          table={table}
          columns={columns}
          primaryKey={data?.primary_key ?? [pkColumn]}
          row={rowPendingEdit}
          pending={editMutation.isPending}
          error={editMutation.error}
          onCancel={() => setRowPendingEdit(null)}
          onSave={(values) => editMutation.mutate({ rowId: String(rowPendingEdit[pkColumn]), values })}
        />
      )}

      {clearModalOpen && (
        <ClearTableModal
          table={table}
          rowCount={total}
          pending={clearMutation.isPending}
          error={clearMutation.error}
          onCancel={() => setClearModalOpen(false)}
          onConfirm={() => clearMutation.mutate()}
        />
      )}
    </div>
  );
}

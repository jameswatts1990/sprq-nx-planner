import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { adminApi } from "@/api/admin";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

import { ClearTableModal } from "./ClearTableModal";
import styles from "./AdminPage.module.css";

const PAGE_SIZE = 50;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface TableRowsPanelProps {
  table: string;
}

export function TableRowsPanel({ table }: TableRowsPanelProps) {
  const [page, setPage] = useState(1);
  const [rowPendingDelete, setRowPendingDelete] = useState<string | null>(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["admin", "rows", table, page],
    queryFn: () => adminApi.listRows(table, { page, page_size: PAGE_SIZE }),
  });

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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className={styles.panelHeader}>
        <h2>
          {table} <span className={styles.rowCount}>({total} row{total === 1 ? "" : "s"})</span>
        </h2>
        <Button
          variant="ghost"
          className={styles.dangerButton}
          onClick={() => setClearModalOpen(true)}
          disabled={total === 0}
        >
          Clear table
        </Button>
      </div>

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
        <div className={styles.status}>This table has no rows.</div>
      )}

      {rows.length > 0 && (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
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
                      <td>
                        {pkColumn && (
                          <Button size="sm" variant="ghost" onClick={() => setRowPendingDelete(rowId)}>
                            Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
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
              variant="primary"
              className={styles.dangerButton}
              onClick={() => deleteMutation.mutate(rowPendingDelete)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete row"}
            </Button>
          </ModalActions>
        </Modal>
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

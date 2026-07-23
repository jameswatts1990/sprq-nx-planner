import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { adminApi } from "@/api/admin";
import { ApiError } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";

import { TableRowsPanel } from "./TableRowsPanel";
import styles from "./AdminPage.module.css";

/** Dev-only raw database inspection/mutation tools. Always registered for now -
 * not gated by environment - remove or gate this page explicitly before a real
 * production launch (see CLAUDE.md). */
export function AdminPage() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [clearBacklogOpen, setClearBacklogOpen] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["admin", "tables"],
    queryFn: () => adminApi.listTables(),
  });

  const backlogCountQuery = useQuery({
    queryKey: ["samples", { status: "backlog", page: 1, page_size: 1 }],
    queryFn: () => samplesApi.list({ status: "backlog", page: 1, page_size: 1 }),
  });

  const clearBacklogMutation = useMutation({
    mutationFn: () => adminApi.clearBacklog(),
    onSuccess: () => {
      setClearBacklogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
    },
  });

  const tables = query.data ?? [];
  const backlogCount = backlogCountQuery.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <Note tone="warn" icon="!">
        Database tools operate directly on raw tables and rows, bypassing the app&apos;s normal business logic. These
        are dev-only tools intended to be removed before a real production launch.
      </Note>

      <div className={styles.actions}>
        <div className={styles.actionText}>
          <h2 className={styles.actionTitle}>Clear backlog</h2>
          <p className={styles.actionHelper}>
            Permanently deletes every sample currently in the backlog ({backlogCount} sample
            {backlogCount === 1 ? "" : "s"}). Scheduled, in-progress, and completed samples are left untouched.
          </p>
        </div>
        <Button
          variant="ghost"
          className={styles.dangerButton}
          onClick={() => setClearBacklogOpen(true)}
          disabled={backlogCount === 0}
        >
          Clear backlog
        </Button>
      </div>

      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <h2 className={styles.sidebarTitle}>Tables</h2>
          {query.isLoading && <div className={styles.status}>Loading tables…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load tables."}
            </Note>
          )}
          <ul className={styles.tableList}>
            {tables.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  className={styles.tableItem}
                  aria-pressed={selectedTable === t.name}
                  onClick={() => setSelectedTable(t.name)}
                >
                  <span>{t.name}</span>
                  <span className={styles.tableItemCount}>{t.row_count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.main}>
          {selectedTable ? (
            <TableRowsPanel table={selectedTable} />
          ) : (
            <div className={styles.status}>Select a table to view its rows.</div>
          )}
        </div>
      </div>

      {clearBacklogOpen && (
        <ConfirmModal
          title="Clear backlog?"
          confirmLabel={`Clear ${backlogCount} sample${backlogCount === 1 ? "" : "s"}`}
          pendingLabel="Clearing…"
          pending={clearBacklogMutation.isPending}
          error={
            clearBacklogMutation.error
              ? clearBacklogMutation.error instanceof ApiError
                ? clearBacklogMutation.error.message
                : "Failed to clear backlog."
              : undefined
          }
          onCancel={() => setClearBacklogOpen(false)}
          onConfirm={() => clearBacklogMutation.mutate()}
        >
          <p className={styles.helper}>
            This permanently deletes all {backlogCount} backlog sample{backlogCount === 1 ? "" : "s"} and their
            barcodes. Scheduled, in-progress, and completed samples are not affected. This can&apos;t be undone.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

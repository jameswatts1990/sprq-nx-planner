import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { adminApi } from "@/api/admin";
import { ApiError } from "@/api/client";
import { Note } from "@/components/ui/Note";

import { TableRowsPanel } from "./TableRowsPanel";
import styles from "./AdminPage.module.css";

/** Dev-only raw database inspection/mutation tools. Always registered for now -
 * not gated by environment - remove or gate this page explicitly before a real
 * production launch (see CLAUDE.md). */
export function AdminPage() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "tables"],
    queryFn: () => adminApi.listTables(),
  });

  const tables = query.data ?? [];

  return (
    <div className={styles.page}>
      <Note tone="warn" icon="!">
        Database tools operate directly on raw tables and rows, bypassing the app&apos;s normal business logic. These
        are dev-only tools intended to be removed before a real production launch.
      </Note>

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
    </div>
  );
}

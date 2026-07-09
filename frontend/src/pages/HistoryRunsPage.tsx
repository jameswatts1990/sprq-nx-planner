import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { schedulesApi } from "@/api/schedules";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { ScheduleOut } from "@/types/schedule";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistoryRunsPage.module.css";

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function matchesQuery(schedule: ScheduleOut, q: string): boolean {
  const haystack = [String(schedule.id), schedule.created_by, schedule.status, schedule.start_date]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export function HistoryRunsPage() {
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(qInput, 300);

  const query = useQuery({
    queryKey: ["schedules", { status, dateFrom, dateTo, page }],
    queryFn: () =>
      schedulesApi.list({
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const items = query.data?.items ?? [];
  // The list endpoint has no free-text search param, so `q` filters within the
  // currently loaded page client-side rather than across the whole result set.
  const visible = q ? items.filter((s) => matchesQuery(s, q)) : items;
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <Card>
        <CardBody>
          <div className={styles.toolbar}>
            <select
              className={styles.select}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input
              type="date"
              className={styles.dateInput}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
            <span>to</span>
            <input
              type="date"
              className={styles.dateInput}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
            <input
              type="search"
              className={styles.search}
              placeholder="Filter this page by id, creator, status…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>

          {query.isLoading && <div className={styles.status}>Loading schedules…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load schedules."}
            </Note>
          )}
          {!query.isLoading && !query.isError && visible.length === 0 && (
            <div className={styles.status}>No schedules found.</div>
          )}

          {visible.length > 0 && (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Created</th>
                    <th>Created by</th>
                    <th>Status</th>
                    <th>Start date</th>
                    <th>Acquisitions</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr key={s.id}>
                      <td className={styles.mono}>
                        <Link to={`/history/runs/${s.id}`}>#{s.id}</Link>
                      </td>
                      <td>{formatDateTime(s.created_at)}</td>
                      <td>{s.created_by}</td>
                      <td>
                        <Badge tone={s.status === "active" ? "success" : "default"}>{s.status}</Badge>
                      </td>
                      <td className={styles.mono}>{s.start_date}</td>
                      <td>{s.kpi ? s.kpi.total_acq : "—"}</td>
                      <td>{s.kpi ? `${s.kpi.duration_days} d` : "—"}</td>
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

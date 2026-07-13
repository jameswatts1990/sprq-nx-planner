import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { CYCLE_STATUSES } from "@/types/common";
import type { CycleStatus } from "@/types/common";
import type { CycleOut } from "@/types/schedule";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistoryRunsPage.module.css";

const STATUS_TONE: Record<CycleStatus, BadgeTone> = {
  planned: "default",
  running: "success",
  completed: "info",
  aborted: "danger",
};

function matchesQuery(cycle: CycleOut, q: string): boolean {
  const haystack = [String(cycle.cycle_id), cycle.instrument_serial, cycle.status, cycle.run_date]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

/** History of runs = Cycles (planned/running/completed/aborted), replacing the old
 * committed-Schedule list. The cycles endpoint returns a plain array for the filter, so
 * free-text `q` refines it client-side. */
export function HistoryRunsPage() {
  const [status, setStatus] = useState("");
  const [instrumentSerial, setInstrumentSerial] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput, 300);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const query = useQuery({
    queryKey: ["cycles", { status, instrumentSerial, dateFrom, dateTo }],
    queryFn: () =>
      cyclesApi.list({
        status: status || undefined,
        instrument_serial: instrumentSerial || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
  });

  const items = query.data ?? [];
  const visible = q ? items.filter((c) => matchesQuery(c, q)) : items;

  return (
    <div className={styles.page}>
      <Card>
        <CardBody>
          <div className={styles.toolbar}>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {CYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={instrumentSerial}
              onChange={(e) => setInstrumentSerial(e.target.value)}
            >
              <option value="">All instruments</option>
              {(instrumentsQuery.data ?? []).map((i) => (
                <option key={i.id} value={i.serial_number}>
                  {i.serial_number}
                </option>
              ))}
            </select>
            <input type="date" className={styles.dateInput} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span>to</span>
            <input type="date" className={styles.dateInput} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <input
              type="search"
              className={styles.search}
              placeholder="Filter by id, instrument, status, date…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>

          {query.isLoading && <div className={styles.status}>Loading runs…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load runs."}
            </Note>
          )}
          {!query.isLoading && !query.isError && visible.length === 0 && (
            <div className={styles.status}>No runs found.</div>
          )}

          {visible.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Run date</th>
                  <th>Instrument</th>
                  <th>Status</th>
                  <th>Movie</th>
                  <th>Cells</th>
                  <th>Planned start</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.cycle_id}>
                    <td className={styles.mono}>
                      <Link to={`/history/runs/${c.cycle_id}`}>#{c.cycle_id}</Link>
                    </td>
                    <td className={styles.mono}>{c.run_date}</td>
                    <td className={styles.mono}>{c.instrument_serial}</td>
                    <td>
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    </td>
                    <td>{c.movie_hours} h</td>
                    <td>{c.stages.length}</td>
                    <td>{new Date(c.planned_start_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

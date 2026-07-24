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
import { allStages } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { CYCLE_STATUSES } from "@/types/common";
import type { CycleStatus } from "@/types/common";
import type { RunOut } from "@/types/schedule";
import { runLabel } from "@/utils/runLabel";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistoryRunsPage.module.css";

const STATUS_TONE: Record<CycleStatus, BadgeTone> = {
  planned: "default",
  running: "success",
  completed: "info",
  aborted: "danger",
};

function matchesQuery(run: RunOut, q: string): boolean {
  const haystack = [String(run.run_id), run.run_name ?? "", run.instrument_serial, run.status, run.load_date]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

/** History of runs = SMRT Link run designs (planned/running/completed/aborted). The runs
 * endpoint returns a plain array for the filter, so free-text `q` refines it client-side. */
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
              placeholder="Filter by id, name, instrument, status, date…"
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
                  <th>Load date</th>
                  <th>Instrument</th>
                  <th>Status</th>
                  <th>Plates</th>
                  <th>Movie</th>
                  <th>Cells</th>
                  <th>Planned start</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const wellCount = allStages(r).length;
                  const longestMovie = r.plates.length > 0 ? Math.max(...r.plates.map((p) => p.movie_hours)) : 0;
                  const plate1 = r.plates.find((p) => p.plate_index === 1) ?? r.plates[0];
                  return (
                    <tr key={r.run_id}>
                      <td className={styles.mono}>
                        <Link to={`/history/runs/${r.run_id}`}>{runLabel(r)}</Link>
                      </td>
                      <td className={styles.mono}>{r.load_date}</td>
                      <td className={styles.mono}>{r.instrument_serial}</td>
                      <td>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      </td>
                      <td>{r.plates.length}</td>
                      <td>{longestMovie} h</td>
                      <td>{wellCount}</td>
                      <td>{plate1 ? new Date(plate1.planned_start_at).toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

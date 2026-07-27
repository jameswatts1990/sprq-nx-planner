import { useQuery } from "@tanstack/react-query";
import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { Pagination } from "@/components/shared/Pagination";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import { allStages } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { CYCLE_STATUSES } from "@/types/common";
import type { RunOut } from "@/types/schedule";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { runLabel } from "@/utils/runLabel";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistoryRunsPage.module.css";

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS: SegmentedOption<number>[] = [25, 50, 100, 200].map((n) => ({ value: n, label: String(n) }));

function matchesQuery(run: RunOut, q: string): boolean {
  const haystack = [String(run.run_id), run.run_name ?? "", run.instrument_serial, run.status, run.load_date]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** One run row. Memoized so that typing in the client-side filter (or paging) only re-renders
 * the rows whose run object actually changed - the per-row work below (allStages, Math.max,
 * and especially the Intl-backed Date.toLocaleString) is otherwise re-run for every visible
 * row on every keystroke. Run objects keep a stable identity across refetches thanks to React
 * Query's structural sharing, so the memo holds. */
const RunRow = memo(function RunRow({ run }: { run: RunOut }) {
  const wellCount = allStages(run).length;
  const longestMovie = run.plates.length > 0 ? Math.max(...run.plates.map((p) => p.movie_hours)) : 0;
  const plate1 = run.plates.find((p) => p.plate_index === 1) ?? run.plates[0];
  return (
    <tr>
      <td className={styles.mono}>
        <Link to={`/history/runs/${run.run_id}`} className="link">
          {runLabel(run)}
        </Link>
      </td>
      <td className={styles.mono}>{run.load_date}</td>
      <td className={styles.mono}>{run.instrument_serial}</td>
      <td>
        <Badge tone={CYCLE_STATUS_TONE[run.status]}>{run.status}</Badge>
      </td>
      <td>{run.plates.length}</td>
      <td>{longestMovie} h</td>
      <td>{wellCount}</td>
      <td>{plate1 ? new Date(plate1.planned_start_at).toLocaleString() : "—"}</td>
    </tr>
  );
});

/** History of runs = SMRT Link run designs (planned/running/completed/aborted). The runs
 * endpoint returns a plain array for the filter, so free-text `q` refines it client-side and
 * the result is paged client-side too (the list grows unboundedly with run history, so this
 * keeps the rendered DOM - and the per-row date formatting - to one page at a time). */
export function HistoryRunsPage() {
  const [status, setStatus] = useState("");
  const [instrumentSerial, setInstrumentSerial] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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

  // Filtered once per (data, query) change rather than on every render/keystroke - matchesQuery
  // builds a lowercased haystack per run, so re-running it for the whole list on each render was
  // the bulk of the felt lag while typing.
  const visible = useMemo(() => {
    const list = query.data ?? [];
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((c) => matchesQuery(c, needle));
  }, [query.data, q]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => visible.slice((safePage - 1) * pageSize, safePage * pageSize),
    [visible, safePage, pageSize],
  );

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
              {CYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={instrumentSerial}
              onChange={(e) => {
                setInstrumentSerial(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All instruments</option>
              {(instrumentsQuery.data ?? []).map((i) => (
                <option key={i.id} value={i.serial_number}>
                  {i.name ? `${i.name} (${i.serial_number})` : i.serial_number}
                </option>
              ))}
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
              placeholder="Filter by id, name, instrument, status, date…"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
            />
            <SegmentedControl
              ariaLabel="Rows per page"
              options={PAGE_SIZE_OPTIONS}
              value={pageSize}
              onChange={(v) => {
                setPageSize(v);
                setPage(1);
              }}
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
            <>
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
                  {pageItems.map((r) => (
                    <RunRow key={r.run_id} run={r} />
                  ))}
                </tbody>
              </table>

              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

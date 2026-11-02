import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { RowsPerPage } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { useClampPage, useListView } from "@/utils/listView";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";

import { RunHistoryTable } from "./RunHistoryTable";
import { RUN_STATUS_FILTERS, RUNS_VIEW, type RunsView, type RunStatusFilter, runHistoryParams } from "./runsView";

/** Run history: every sequencing run - past, active and planned - one row each with its wells at
 * a glance. Searched, filtered, sorted and paged server-side (GET /api/cycles/history), so the
 * page costs the same however long the history grows. */
export function HistoryRunsPage() {
  const { view, update, onSort, search, setSearch } = useListView(RUNS_VIEW);
  const location = useLocation();

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const params = runHistoryParams(view);
  const query = useQuery({
    // Under ["cycles"] so invalidateScheduleRelated refreshes it after any run change.
    queryKey: ["cycles", "history", params],
    queryFn: () => cyclesApi.listHistory(params),
    // Keep the current rows on screen (dimmed) while the next page / filter loads.
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / view.pageSize));
  const searching = view.q !== "";
  const dated = view.from !== "" || view.to !== "";
  useClampPage(query.isSuccess && !query.isPlaceholderData, view.page, totalPages, update);

  const linkState = useMemo<SampleDetailLocationState>(
    () => ({ backNav: { to: `${location.pathname}${location.search}`, label: "Run history" } }),
    [location.pathname, location.search],
  );

  // An instrument filter from a link can name one that's since been retired - keep it selectable.
  const instruments = instrumentsQuery.data ?? [];
  const instrumentMissing = view.instrument !== "" && !instruments.some((i) => i.serial_number === view.instrument);

  return (
    <div className={list.page}>
      <PageHeader
        title="Run history"
        intro="Every sequencing run — past, active and planned — with how each well went at a glance."
      />
      <Card>
        <CardHeader badge={query.data ? `${total} run${total === 1 ? "" : "s"}` : undefined}>
          <h2>{searching ? "Search results" : "Runs"}</h2>
        </CardHeader>
        <CardBody>
          <div className={list.toolbar}>
            <input
              type="search"
              className={list.search}
              placeholder="Search runs (#45), run names, Pool / Sanger / Plate IDs, barcodes, cells, trays (T12), instruments…"
              aria-label="Search runs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={view.status}
              onChange={(e) => update({ status: e.target.value as RunStatusFilter })}
              aria-label="Filter by run status"
            >
              {RUN_STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={view.chemistry}
              onChange={(e) => update({ chemistry: e.target.value as RunsView["chemistry"] })}
              aria-label="Filter by chemistry"
            >
              <option value="">All chemistries</option>
              <option value="sprq_nx">SPRQ-Nx</option>
              <option value="sprq">SPRQ (single use)</option>
            </select>
            <select
              value={view.instrument}
              onChange={(e) => update({ instrument: e.target.value })}
              aria-label="Filter by instrument"
            >
              <option value="">All instruments</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.serial_number}>
                  {i.name ? `${i.name} (${i.serial_number})` : i.serial_number}
                </option>
              ))}
              {instrumentMissing && <option value={view.instrument}>{view.instrument}</option>}
            </select>
          </div>
          <div className={list.subbar}>
            <div className={list.control}>
              <span className={list.controlLabel}>Loaded between</span>
              <input
                type="date"
                value={view.from}
                max={view.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
                aria-label="Load date from"
              />
              <span>and</span>
              <input
                type="date"
                value={view.to}
                min={view.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
                aria-label="Load date to"
              />
              {dated && (
                <Button size="sm" variant="ghost" onClick={() => update({ from: "", to: "" })}>
                  Any date
                </Button>
              )}
            </div>
            <RowsPerPage value={view.pageSize} onChange={(pageSize) => update({ pageSize })} />
          </div>

          {query.isLoading && <div className="status">Loading runs…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the runs.")}
            </Note>
          )}
          {query.isSuccess && total === 0 && (
            <div className="status">
              {searching ? `No runs match “${view.q}” with these filters.` : "No runs match these filters."}
              {view.status !== "all" && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" onClick={() => update({ status: "all" })}>
                    Show any status
                  </Button>
                </>
              )}
              {dated && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" onClick={() => update({ from: "", to: "" })}>
                    Show any date
                  </Button>
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <RunHistoryTable
                rows={rows}
                sort={{ by: view.sort, dir: view.dir, onSort }}
                highlightMatches={searching}
                defaultExpanded={searching && total === 1}
                linkState={linkState}
                updating={query.isPlaceholderData}
              />
              <Pagination
                page={Math.min(view.page, totalPages)}
                totalPages={totalPages}
                onPageChange={(page) => update({ page })}
              />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

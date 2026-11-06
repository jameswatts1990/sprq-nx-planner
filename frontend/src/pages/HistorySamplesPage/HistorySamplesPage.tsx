import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { RowsPerPage } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { useClampPage, useListView } from "@/utils/listView";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";

import { SampleHistoryTable } from "./SampleHistoryTable";
import { SAMPLE_STATUS_FILTERS, SAMPLES_VIEW, type SampleStatusFilter, sampleHistoryParams } from "./samplesView";

/** Samples: every sample RunNx knows about, whatever its status - where it is now and every run
 * it has been on. Searched, filtered, sorted and paged server-side (GET /api/samples/history). */
export function HistorySamplesPage() {
  const { view, update, onSort, search, setSearch } = useListView(SAMPLES_VIEW);
  const location = useLocation();

  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities", "all"],
    queryFn: () => samplesApi.listPriorities(),
  });

  const params = sampleHistoryParams(view);
  const query = useQuery({
    queryKey: ["samples", "history", params],
    queryFn: () => samplesApi.listHistory(params),
    // Keep the current rows on screen (dimmed) while the next page / filter loads.
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / view.pageSize));
  const searching = view.q !== "";
  useClampPage(query.isSuccess && !query.isPlaceholderData, view.page, totalPages, update);

  const linkState = useMemo<SampleDetailLocationState>(
    () => ({ backNav: { to: `${location.pathname}${location.search}`, label: "Samples" } }),
    [location.pathname, location.search],
  );

  // A priority filter from a link can name one no sample carries any more - keep it selectable.
  const priorities = prioritiesQuery.data ?? [];
  const priorityMissing = view.priority !== "" && !priorities.includes(view.priority);

  return (
    <div className={list.page}>
      <PageHeader
        help="history"
        title="Samples"
        intro="Every sample, whatever its status — where it is now and every run it has been on."
      />
      <Card>
        <CardHeader badge={query.data ? `${total} sample${total === 1 ? "" : "s"}` : undefined}>
          <h2>{searching ? "Search results" : "All samples"}</h2>
        </CardHeader>
        <CardBody>
          <div className={list.toolbar}>
            <input
              type="search"
              className={list.search}
              placeholder="Search Pool IDs, Sanger IDs, Plate IDs, barcodes, priorities…"
              aria-label="Search samples"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={view.status}
              onChange={(e) => update({ status: e.target.value as SampleStatusFilter })}
              aria-label="Filter by sample status"
            >
              {SAMPLE_STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={view.priority}
              onChange={(e) => update({ priority: e.target.value })}
              aria-label="Filter by priority"
            >
              <option value="">All priorities</option>
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {priorityMissing && <option value={view.priority}>{view.priority}</option>}
            </select>
          </div>
          <div className={list.subbar}>
            <RowsPerPage value={view.pageSize} onChange={(pageSize) => update({ pageSize })} />
          </div>

          {query.isLoading && <div className="status">Loading samples…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the samples.")}
            </Note>
          )}
          {query.isSuccess && total === 0 && (
            <div className="status">
              {searching ? `No samples match “${view.q}” with these filters.` : "No samples match these filters."}
              {view.status !== "all" && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" onClick={() => update({ status: "all" })}>
                    Show any status
                  </Button>
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <SampleHistoryTable
                rows={rows}
                sort={{ by: view.sort, dir: view.dir, onSort }}
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

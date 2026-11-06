import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { auditApi } from "@/api/audit";
import { errorMessage } from "@/api/client";
import { RowsPerPage } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { ACTION_GROUPS } from "@/utils/auditLabels";
import { useClampPage, useListView } from "@/utils/listView";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";

import { ActivityTable } from "./ActivityTable";
import { ACTIVITY_VIEW, activityParams } from "./activityView";
import styles from "./HistoryActivityPage.module.css";

const SCOPE_NOUN = { run: "run", sample: "sample", cell: "cell" } as const;

/** Activity: the audit trail - every change to the schedule, runs, samples, cells, credits,
 * instruments and settings, who made it and when, newest first. Filtered and paged server-side
 * (GET /api/audit-log). A detail page's "View activity" opens it scoped to that run / sample /
 * cell. */
export function HistoryActivityPage() {
  const { view, update, search, setSearch } = useListView(ACTIVITY_VIEW);
  const location = useLocation();

  const actorsQuery = useQuery({ queryKey: ["audit-log", "actors"], queryFn: auditApi.actors });

  const params = activityParams(view);
  const query = useQuery({
    queryKey: ["audit-log", params],
    queryFn: () => auditApi.list(params),
    // Every change anywhere adds a row, so opening the page always fetches fresh.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / view.pageSize));
  const dated = view.from !== "" || view.to !== "";
  const filtered = view.q !== "" || view.group !== "" || view.who !== "" || dated;
  useClampPage(query.isSuccess && !query.isPlaceholderData, view.page, totalPages, update);

  const linkState = useMemo<SampleDetailLocationState>(
    () => ({ backNav: { to: `${location.pathname}${location.search}`, label: "Activity" } }),
    [location.pathname, location.search],
  );

  // A "who" from a link may no longer be in the list (renamed browser) - keep it selectable.
  const actors = actorsQuery.data ?? [];
  const whoMissing = view.who !== "" && !actors.includes(view.who);
  const scopeName = view.scopeKind ? view.scopeLabel || `${SCOPE_NOUN[view.scopeKind]} #${view.scopeId}` : "";

  return (
    <div className={list.page}>
      <PageHeader
        help="activity"
        title="Activity"
        intro="Who changed what, and when — every schedule, run, sample, cell, credit, instrument and settings change, newest first."
      />
      <Card>
        <CardHeader badge={query.data ? `${total} change${total === 1 ? "" : "s"}` : undefined}>
          <h2>Changes</h2>
        </CardHeader>
        <CardBody>
          {view.scopeKind && (
            <div className={styles.scope}>
              <span>
                Showing activity for {SCOPE_NOUN[view.scopeKind]} <b>{scopeName}</b> and everything placed on it.
              </span>
              <Button size="sm" variant="ghost" onClick={() => update({ scopeKind: "", scopeId: 0, scopeLabel: "" })}>
                Show all activity
              </Button>
            </div>
          )}
          <div className={list.toolbar}>
            <input
              type="search"
              className={list.search}
              placeholder="Search names, Pool IDs, notes, reasons, case numbers…"
              aria-label="Search activity"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={view.group} onChange={(e) => update({ group: e.target.value })} aria-label="Filter by kind of change">
              <option value="">Every kind of change</option>
              {ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <select value={view.who} onChange={(e) => update({ who: e.target.value })} aria-label="Filter by who made it">
              <option value="">Anyone</option>
              {actors.map((name) => (
                <option key={name} value={name}>
                  {name === "unknown" ? "Unknown (no name set)" : name}
                </option>
              ))}
              {whoMissing && <option value={view.who}>{view.who}</option>}
            </select>
          </div>
          <div className={list.subbar}>
            <div className={list.control}>
              <span className={list.controlLabel}>Changed between</span>
              <input
                type="date"
                value={view.from}
                max={view.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
                aria-label="Changed from"
              />
              <span>and</span>
              <input
                type="date"
                value={view.to}
                min={view.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
                aria-label="Changed to"
              />
              {dated && (
                <Button size="sm" variant="ghost" onClick={() => update({ from: "", to: "" })}>
                  Any date
                </Button>
              )}
            </div>
            <RowsPerPage value={view.pageSize} onChange={(pageSize) => update({ pageSize })} />
          </div>

          {query.isLoading && <div className="status">Loading activity…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the activity.")}
            </Note>
          )}
          {query.isSuccess && total === 0 && (
            <div className="status">
              {filtered ? "No changes match these filters." : "Nothing has been changed yet."}
              {filtered && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" onClick={() => update({ q: "", group: "", who: "", from: "", to: "" })}>
                    Clear filters
                  </Button>
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <ActivityTable rows={rows} linkState={linkState} updating={query.isPlaceholderData} />
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

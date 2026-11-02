import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { cellsApi } from "@/api/cells";
import { errorMessage } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { RowsPerPage } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { endOfWeekIso, endOfWeekLabel } from "@/utils/calendarDates";
import { useClampPage, useListView } from "@/utils/listView";
import { resolveBackNav, type SampleDetailLocationState } from "@/utils/sampleBackNav";

import {
  type AsOf,
  CELLS_VIEW,
  type CellsView,
  QC_FILTERS,
  readCellsView,
  STATUS_FILTERS,
  type StatusFilter,
  trayListParams,
  writeCellsView,
} from "./cellsView";
import { RegisterInProgressCellModal } from "./RegisterInProgressCellModal";
import { TrayTable } from "./TrayTable";

/** The as-of instant for the toggle, resolved only when the toggle changes. "Now" is floored to
 * the minute: a fresh Date every render would change the query key and refetch in a loop, and a
 * whole minute lets a quick Back from a cell reuse the cached page. */
function useAsOfIso(asOf: AsOf): string {
  return useMemo(() => {
    if (asOf === "eow") return endOfWeekIso();
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString();
  }, [asOf]);
}

/** The reference instant behind every time-based figure on the page (uses spent, windows,
 * status) - always visible so the "as of" context is never ambiguous. */
function AsOfToggle({ value, onChange }: { value: AsOf; onChange: (v: AsOf) => void }) {
  return (
    <div className={list.control}>
      <span className={list.controlLabel}>Showing data as of</span>
      <SegmentedControl<AsOf>
        ariaLabel="Reference time"
        value={value}
        onChange={onChange}
        options={[
          { value: "now", label: "Now", title: "Uses, windows and status as they stand right now" },
          {
            value: "eow",
            label: `End of week (${endOfWeekLabel()})`,
            title: "How every tray will stand once this week's scheduled runs have gone",
          },
        ]}
      />
    </div>
  );
}

/** Cells: every physical SMRT cell tray as a row, or - via /cells?tray=N, the link every "Tray N"
 * in the app uses - one tray on its own. */
export function CellsPage() {
  const [searchParams] = useSearchParams();
  const trayParam = searchParams.get("tray");
  const trayId = trayParam && /^\d+$/.test(trayParam) ? Number(trayParam) : null;
  return trayId !== null ? <SingleTray trayId={trayId} /> : <TrayList />;
}

function TrayList() {
  const { view, update, onSort, search, setSearch } = useListView(CELLS_VIEW);
  const location = useLocation();
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const asOfIso = useAsOfIso(view.asOf);
  const params = trayListParams(view, asOfIso);
  const query = useQuery({
    queryKey: ["cells", "trays", params],
    queryFn: () => cellsApi.listTrays(params),
    // Keep the current rows on screen (dimmed) while the next page / filter loads.
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / view.pageSize));
  const searching = view.q !== "";
  useClampPage(query.isSuccess && !query.isPlaceholderData, view.page, totalPages, update);

  const linkState = useMemo<SampleDetailLocationState>(
    () => ({ backNav: { to: `${location.pathname}${location.search}`, label: "Cells" } }),
    [location.pathname, location.search],
  );

  // An instrument filter from a link can name one that's since been retired - keep it selectable.
  const instruments = instrumentsQuery.data ?? [];
  const instrumentMissing = view.instrument !== "" && !instruments.some((i) => i.serial_number === view.instrument);

  return (
    <div className={list.page}>
      <PageHeader
        title="Cells"
        intro="Every physical SMRT cell tray: each cell's state at a glance, and what ran on it."
        actions={
          <Button
            variant="ghost"
            onClick={() => setRegisterOpen(true)}
            title="Go-live only: add a cell that was already running on an instrument before RunNx"
          >
            Register in-progress cell
          </Button>
        }
      />
      <Card>
        <CardHeader badge={query.data ? `${total} tray${total === 1 ? "" : "s"}` : undefined}>
          <h2>{searching ? "Search results" : "Cell trays"}</h2>
        </CardHeader>
        <CardBody>
          <div className={list.toolbar}>
            <input
              type="search"
              className={list.search}
              placeholder="Search cells, trays (T123), Pool / Sanger / Plate IDs, runs (#45), barcodes, instruments…"
              aria-label="Search cells"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={view.status}
              onChange={(e) => update({ status: e.target.value as StatusFilter })}
              aria-label="Filter by cell status"
              title="Shows each tray with at least one cell in this state - always with all of its cells"
            >
              <optgroup label="Trays with a cell that is…">
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="PacBio credit">
                {QC_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <select
              value={view.chemistry}
              onChange={(e) => update({ chemistry: e.target.value as CellsView["chemistry"] })}
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
            <AsOfToggle value={view.asOf} onChange={(asOf) => update({ asOf })} />
            <RowsPerPage value={view.pageSize} onChange={(pageSize) => update({ pageSize })} />
          </div>

          {query.isLoading && <div className="status">Loading trays…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the trays.")}
            </Note>
          )}
          {query.isSuccess && total === 0 && (
            <div className="status">
              {searching ? `No cells match “${view.q}” with these filters.` : "No trays match these filters."}
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
              <TrayTable
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

      {registerOpen && (
        <RegisterInProgressCellModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={() => {
            setRegisterOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["cells"] });
          }}
        />
      )}
    </div>
  );
}

/** One tray on its own - the page behind every "Tray N" link (cell pages, the Schedule grid's
 * instrument cell map, QC). Its row opens expanded, with the tray-wide actions. */
function SingleTray({ trayId }: { trayId: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const asOf = readCellsView(searchParams).asOf;
  const asOfIso = useAsOfIso(asOf);
  const back = resolveBackNav(location.state, { to: "/cells", label: "All cells" });

  const query = useQuery({
    queryKey: ["cells", "trays", { tray_id: trayId, as_of: asOfIso }],
    queryFn: () => cellsApi.listTrays({ tray_id: trayId, as_of: asOfIso }),
  });
  const row = query.data?.items[0];

  const linkState = useMemo<SampleDetailLocationState>(
    () => ({ backNav: { to: `${location.pathname}${location.search}`, label: `Tray ${trayId}` } }),
    [location.pathname, location.search, trayId],
  );

  return (
    <div className={list.page}>
      <PageHeader title={<span className={list.mono}>Tray {trayId}</span>} back={back} />
      <Card>
        <CardBody>
          <div className={list.subbar}>
            <AsOfToggle
              value={asOf}
              onChange={(v) =>
                // Carry the router state along so Back still returns to where the tray was opened from.
                setSearchParams((prev) => writeCellsView(prev, { asOf: v }), { replace: true, state: location.state })
              }
            />
          </div>
          {query.isLoading && <div className="status">Loading tray…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the tray.")}
            </Note>
          )}
          {query.isSuccess && !row && (
            <div className="status">No cells found for tray {trayId} — it may have been fully cleared.</div>
          )}
          {row && <TrayTable rows={[row]} defaultExpanded linkState={linkState} />}
        </CardBody>
      </Card>
    </div>
  );
}

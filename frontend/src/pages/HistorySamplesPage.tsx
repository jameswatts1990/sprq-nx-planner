import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { Pagination } from "@/components/shared/Pagination";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { SampleCellUseOut, SampleOut } from "@/types/sample";
import { runLabel } from "@/utils/runLabel";
import { useClientSort } from "@/utils/useClientSort";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistorySamplesPage.module.css";

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** One value per sortable column of a sample's cell-use list. That list is fully loaded
 * (lazily fetched when the row expands), so it sorts in the browser. */
type CellUseSortKey = "run" | "plate" | "cell" | "well" | "status" | "started" | "completed" | "notes";
const CELL_USE_SORT_ACCESSORS: Record<CellUseSortKey, (u: SampleCellUseOut) => string | number | null> = {
  run: (u) => u.run_name ?? u.run_batch_id,
  plate: (u) => u.plate_number,
  cell: (u) => u.cell_code,
  well: (u) => u.well,
  status: (u) => u.status,
  started: (u) => u.started_at,
  completed: (u) => u.completed_at,
  notes: (u) => u.outcome_notes,
};

export function HistorySamplesPage() {
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput, 350);
  const [page, setPage] = useState(1);
  // Server-side sort so it spans every page, not just the loaded one. Defaults to most
  // recently updated first — the natural "what happened last" history order.
  const [sortBy, setSortBy] = useState<SampleSortBy>("updated_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Stable identity so the memoized rows below only re-render the one whose `expanded` flips,
  // rather than the whole page on every parent render (e.g. each search keystroke).
  const handleToggle = useCallback((id: number) => setExpandedId((cur) => (cur === id ? null : id)), []);

  const toggleSort = useCallback((field: SampleSortBy) => {
    setPage(1);
    setSortBy((cur) => {
      if (cur === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return cur;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const sortableHeader = useCallback(
    (label: string, field: SampleSortBy) => (
      <SortableColumnHeader label={label} active={sortBy === field} dir={sortDir} onClick={() => toggleSort(field)} />
    ),
    [sortBy, sortDir, toggleSort],
  );

  const query = useQuery({
    queryKey: ["samples", { status: "completed,failed", q, sortBy, sortDir, page, page_size: PAGE_SIZE }],
    queryFn: () =>
      samplesApi.list({
        status: "completed,failed",
        q: q || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader badge={`${total} sample${total === 1 ? "" : "s"}`}>
          <h2>Completed &amp; failed samples</h2>
        </CardHeader>
        <CardBody>
          <input
            type="search"
            className={styles.search}
            placeholder="Search by container ID, barcode, or parent sample…"
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              setPage(1);
            }}
          />

          {query.isLoading && <div className={styles.status}>Loading samples…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load samples."}
            </Note>
          )}
          {!query.isLoading && !query.isError && items.length === 0 && (
            <div className={styles.status}>No completed or failed samples found.</div>
          )}

          {items.length > 0 && (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th />
                    <th>{sortableHeader("Container ID", "external_id")}</th>
                    <th>{sortableHeader("Status", "status")}</th>
                    <th>{sortableHeader("Barcodes", "barcode")}</th>
                    <th>{sortableHeader("Parent sample", "parent_sample")}</th>
                    <th>{sortableHeader("Target OPLC", "target_oplc")}</th>
                    <th>{sortableHeader("Actual OPLC", "actual_oplc")}</th>
                    <th>{sortableHeader("Priority", "priority")}</th>
                    <th>{sortableHeader("Updated", "updated_at")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <SampleRow key={s.id} sample={s} expanded={expandedId === s.id} onToggle={handleToggle} />
                  ))}
                </tbody>
              </table>

              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

interface SampleRowProps {
  sample: SampleOut;
  expanded: boolean;
  /** Receives this row's sample id so the parent can pass one stable handler to every row
   * (keeps this memoized row from re-rendering just because a new closure was created). */
  onToggle: (id: number) => void;
}

/** Keeps this view simple (per spec, lower priority): rather than a separate sample
 * detail page, each row expands inline and lazily fetches samplesApi.get(id) to show
 * the sample's cell_uses. Memoized so a search keystroke re-renders only the row whose
 * expanded state changed, not all 25 (each row also owns a lazy detail useQuery). */
const SampleRow = memo(function SampleRow({ sample, expanded, onToggle }: SampleRowProps) {
  const detailQuery = useQuery({
    queryKey: ["sample", sample.id],
    queryFn: () => samplesApi.get(sample.id),
    enabled: expanded,
  });

  const cellUseSort = useClientSort(detailQuery.data?.cell_uses ?? [], CELL_USE_SORT_ACCESSORS, { by: "run", dir: "asc" });

  return (
    <>
      <tr className={styles.row} onClick={() => onToggle(sample.id)}>
        <td className={styles.toggleCell}>{expanded ? "▼" : "▶"}</td>
        <td>
          {sample.external_id}{" "}
          <DuplicateBadge index={sample.duplicate_index} total={sample.duplicate_total} />
        </td>
        <td>
          <Badge tone={sample.status === "completed" ? "success" : "danger"}>{sample.status}</Badge>
        </td>
        <td>
          <BarcodeChips barcodes={sample.barcodes} />
        </td>
        <td>{sample.parent_sample ?? "—"}</td>
        <td>{sample.target_oplc ?? "—"}</td>
        <td>{sample.actual_oplc ?? "—"}</td>
        <td>{sample.priority ?? "—"}</td>
        <td>{formatDateTime(sample.updated_at)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className={styles.detailCell}>
            {detailQuery.isLoading && <div className={styles.status}>Loading cell uses…</div>}
            {detailQuery.isError && (
              <Note tone="bad" icon="!">
                {detailQuery.error instanceof ApiError ? detailQuery.error.message : "Failed to load sample."}
              </Note>
            )}
            {detailQuery.data &&
              (detailQuery.data.cell_uses.length === 0 ? (
                <div className={styles.status}>No cell uses recorded.</div>
              ) : (
                <table className={styles.innerTable}>
                  <thead>
                    <tr>
                      <th>
                        <SortableColumnHeader
                          label="Run"
                          active={cellUseSort.sortBy === "run"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("run")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Plate"
                          active={cellUseSort.sortBy === "plate"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("plate")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Cell"
                          active={cellUseSort.sortBy === "cell"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("cell")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Well"
                          active={cellUseSort.sortBy === "well"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("well")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Status"
                          active={cellUseSort.sortBy === "status"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("status")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Started"
                          active={cellUseSort.sortBy === "started"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("started")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Completed"
                          active={cellUseSort.sortBy === "completed"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("completed")}
                        />
                      </th>
                      <th>
                        <SortableColumnHeader
                          label="Notes"
                          active={cellUseSort.sortBy === "notes"}
                          dir={cellUseSort.sortDir}
                          onClick={() => cellUseSort.toggle("notes")}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cellUseSort.sorted.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link to={`/history/runs/${u.run_batch_id}`} className="link">
                            {runLabel({ run_id: u.run_batch_id, run_name: u.run_name })}
                          </Link>
                        </td>
                        <td>{u.plate_number != null ? `Plate ${u.plate_number}` : "—"}</td>
                        <td className={styles.mono}>
                          <Link to={`/cells/${u.cell_id}`} className="link">
                            {u.cell_code}
                          </Link>
                        </td>
                        <td className={styles.mono}>{u.well}</td>
                        <td>
                          <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{u.status}</Badge>
                        </td>
                        <td>{u.started_at ? formatDateTime(u.started_at) : "—"}</td>
                        <td>{u.completed_at ? formatDateTime(u.completed_at) : "—"}</td>
                        <td>{u.outcome_notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </td>
        </tr>
      )}
    </>
  );
});

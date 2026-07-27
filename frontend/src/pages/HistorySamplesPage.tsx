import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
import { runLabel } from "@/utils/runLabel";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./HistorySamplesPage.module.css";

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function HistorySamplesPage() {
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput, 350);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Stable identity so the memoized rows below only re-render the one whose `expanded` flips,
  // rather than the whole page on every parent render (e.g. each search keystroke).
  const handleToggle = useCallback((id: number) => setExpandedId((cur) => (cur === id ? null : id)), []);

  const query = useQuery({
    queryKey: ["samples", { status: "completed,failed", q, page, page_size: PAGE_SIZE }],
    queryFn: () => samplesApi.list({ status: "completed,failed", q: q || undefined, page, page_size: PAGE_SIZE }),
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
                    <th>Container ID</th>
                    <th>Status</th>
                    <th>Barcodes</th>
                    <th>Parent sample</th>
                    <th>Target OPLC</th>
                    <th>Volume</th>
                    <th>Priority</th>
                    <th>Updated</th>
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

  return (
    <>
      <tr className={styles.row} onClick={() => onToggle(sample.id)}>
        <td className={styles.toggleCell}>{expanded ? "▼" : "▶"}</td>
        <td>{sample.external_id}</td>
        <td>
          <Badge tone={sample.status === "completed" ? "success" : "danger"}>{sample.status}</Badge>
        </td>
        <td>
          <BarcodeChips barcodes={sample.barcodes} />
        </td>
        <td>{sample.parent_sample ?? "—"}</td>
        <td>{sample.target_oplc ?? "—"}</td>
        <td>{sample.volume ?? "—"}</td>
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
                      <th>Run</th>
                      <th>Plate</th>
                      <th>Cell</th>
                      <th>Well</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Completed</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailQuery.data.cell_uses.map((u) => (
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

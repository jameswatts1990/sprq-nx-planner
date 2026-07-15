import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
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
            placeholder="Search by external ID, barcode, or parent sample…"
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
                    <th>External ID</th>
                    <th>Status</th>
                    <th>Barcodes</th>
                    <th>Parent sample</th>
                    <th>OPLC</th>
                    <th>Volume</th>
                    <th>Priority</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <SampleRow
                      key={s.id}
                      sample={s}
                      expanded={expandedId === s.id}
                      onToggle={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
                    />
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
  onToggle: () => void;
}

/** Keeps this view simple (per spec, lower priority): rather than a separate sample
 * detail page, each row expands inline and lazily fetches samplesApi.get(id) to show
 * the sample's cell_uses. */
function SampleRow({ sample, expanded, onToggle }: SampleRowProps) {
  const detailQuery = useQuery({
    queryKey: ["sample", sample.id],
    queryFn: () => samplesApi.get(sample.id),
    enabled: expanded,
  });

  return (
    <>
      <tr className={styles.row} onClick={onToggle}>
        <td className={styles.toggleCell}>{expanded ? "▼" : "▶"}</td>
        <td>{sample.external_id}</td>
        <td>
          <Badge tone={sample.status === "completed" ? "success" : "danger"}>{sample.status}</Badge>
        </td>
        <td>
          <BarcodeChips barcodes={sample.barcodes} />
        </td>
        <td>{sample.parent_sample ?? "—"}</td>
        <td>{sample.oplc ?? "—"}</td>
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
                          <Link to={`/history/runs/${u.cycle_id}`}>#{u.cycle_id}</Link>
                        </td>
                        <td className={styles.mono}>{u.cell_code}</td>
                        <td className={styles.mono}>{u.well}</td>
                        <td>{u.status}</td>
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
}

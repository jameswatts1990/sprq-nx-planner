import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./CellDetailPage.module.css";

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function CellDetailPage() {
  const { cellId } = useParams<{ cellId: string }>();
  const id = Number(cellId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["cell", id],
    queryFn: () => cellsApi.get(id),
    enabled: idIsValid,
  });

  const retireMutation = useMutation({
    mutationFn: () => cellsApi.retire(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cell", id] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
    },
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          Invalid cell id.
        </Note>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className={styles.status}>Loading cell…</div>;
  }

  if (query.isError) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load cell."}
        </Note>
      </div>
    );
  }

  const cell = query.data;
  if (!cell) {
    return <div className={styles.status}>Cell not found.</div>;
  }

  const hasPlannedUse = cell.use_history.some((u) => u.status === "planned");
  const retireDisabled = hasPlannedUse || cell.status === "retired" || retireMutation.isPending;
  const retireTooltip = hasPlannedUse
    ? "Cannot retire a cell with planned (not yet started) uses."
    : cell.status === "retired"
      ? "Cell is already retired."
      : undefined;

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader badge={<Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>}>
          <h2>{cell.code}</h2>
        </CardHeader>
        <CardBody>
          <div className={styles.headerGrid}>
            <div>
              <span className={styles.label}>Uses</span>
              <span className={styles.value}>
                {cell.uses_consumed} / {cell.max_uses} ({cell.uses_remaining} remaining)
              </span>
            </div>
            <div>
              <span className={styles.label}>Window elapsed</span>
              <span className={styles.value}>
                {cell.window_hours_elapsed !== null ? `${cell.window_hours_elapsed.toFixed(1)} h` : "—"}
              </span>
            </div>
            <div>
              <span className={styles.label}>Window breached</span>
              <span className={styles.value}>{cell.window_breached ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className={styles.label}>Current location</span>
              <span className={styles.value}>
                {cell.current_instrument_serial
                  ? `${cell.current_instrument_serial}${cell.current_well ? ` · ${cell.current_well}` : ""}`
                  : "—"}
              </span>
            </div>
            <div>
              <span className={styles.label}>First use started</span>
              <span className={styles.value}>{formatDateTime(cell.first_use_started_at)}</span>
            </div>
            <div>
              <span className={styles.label}>Created</span>
              <span className={styles.value}>{formatDateTime(cell.created_at)}</span>
            </div>
          </div>

          {cell.burned_barcodes.length > 0 && (
            <div className={styles.burnedRow}>
              <span className={styles.label}>Burned barcodes</span>
              <BarcodeChips barcodes={cell.burned_barcodes} />
            </div>
          )}

          <div className={styles.retireRow}>
            <span title={retireTooltip}>
              <Button variant="ghost" onClick={() => retireMutation.mutate()} disabled={retireDisabled}>
                {retireMutation.isPending ? "Retiring…" : "Retire cell"}
              </Button>
            </span>
            {retireMutation.isError && (
              <Note tone="bad" icon="!">
                {retireMutation.error instanceof ApiError ? retireMutation.error.message : "Failed to retire cell."}
              </Note>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2>Use history</h2>
        </CardHeader>
        <CardBody>
          {cell.use_history.length === 0 ? (
            <div className={styles.status}>No uses recorded yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Well</th>
                  <th>Status</th>
                  <th>Sample</th>
                  <th>Container ID</th>
                  <th>Barcodes</th>
                  <th>Priority</th>
                  <th>Target OPLC</th>
                  <th>Adaptive Loading</th>
                  <th>Full Res. Base Q</th>
                  <th>Kinetics</th>
                  <th>Instrument</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {cell.use_history.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/history/runs/${u.cycle_id}`}>#{u.cycle_id}</Link>
                    </td>
                    <td className={styles.mono}>{u.well}</td>
                    <td>
                      <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{u.status}</Badge>
                    </td>
                    <td>{u.sample_external_id ?? "—"}</td>
                    <td>{u.sample_container_id ?? "—"}</td>
                    <td>
                      <BarcodeChips barcodes={u.barcodes} />
                    </td>
                    <td>{u.sample_priority ?? "—"}</td>
                    <td>{u.sample_target_oplc ?? "—"}</td>
                    <td>{u.sample_adaptive_loading ?? "—"}</td>
                    <td>{u.sample_full_resolution_base_q ?? "—"}</td>
                    <td>{u.sample_ccs_kinetics ?? "—"}</td>
                    <td>{u.instrument_serial ?? "—"}</td>
                    <td>{formatDateTime(u.started_at)}</td>
                    <td>{formatDateTime(u.completed_at)}</td>
                    <td>{u.outcome_notes ?? "—"}</td>
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

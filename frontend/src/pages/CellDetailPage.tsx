import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { CellUseHistoryOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { canRecordQcOutcome } from "@/utils/cellUseQc";
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

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [bumpedCount, setBumpedCount] = useState<number | null>(null);
  const [failTarget, setFailTarget] = useState<CellUseHistoryOut | null>(null);
  const [abortTarget, setAbortTarget] = useState<CellUseHistoryOut | null>(null);
  const [caseNumber, setCaseNumber] = useState("");

  function invalidateCell() {
    void queryClient.invalidateQueries({ queryKey: ["cell", id] });
    void queryClient.invalidateQueries({ queryKey: ["cells"] });
  }

  const retireMutation = useMutation({
    mutationFn: () => cellsApi.retire(id),
    onSuccess: invalidateCell,
  });

  const stopMutation = useMutation({
    mutationFn: (reason: string) => cellsApi.stop(id, { reason: reason || null }),
    onSuccess: (data) => {
      invalidateCell();
      setStopModalOpen(false);
      setBumpedCount(data.bumped_sample_ids.length);
    },
  });

  const markFailedMutation = useMutation({
    mutationFn: ({ useId, notes }: { useId: number; notes: string }) =>
      cellUsesApi.updateStatus(useId, { status: "failed", notes: notes || undefined }),
    onSuccess: () => {
      invalidateCell();
      setFailTarget(null);
    },
  });

  const markAbortedMutation = useMutation({
    mutationFn: ({ useId, notes }: { useId: number; notes: string }) =>
      cellUsesApi.updateStatus(useId, { status: "aborted", notes: notes || undefined }),
    onSuccess: () => {
      invalidateCell();
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      setAbortTarget(null);
    },
  });

  const reportMutation = useMutation({
    mutationFn: (caseNum: string) => cellsApi.reportToPacbio(id, { case_number: caseNum }),
    onSuccess: () => {
      invalidateCell();
      setCaseNumber("");
    },
  });

  const confirmCreditMutation = useMutation({
    mutationFn: () => cellsApi.confirmCredit(id),
    onSuccess: invalidateCell,
  });

  const receiveCreditMutation = useMutation({
    mutationFn: () => cellsApi.receiveCredit(id),
    onSuccess: invalidateCell,
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
  const retireDisabled =
    hasPlannedUse || cell.status === "retired" || cell.status === "stopped" || retireMutation.isPending;
  const retireTooltip = hasPlannedUse
    ? "Cannot retire a cell with planned (not yet started) uses."
    : cell.status === "retired"
      ? "Cell is already retired."
      : cell.status === "stopped"
        ? "Cell is stopped."
        : undefined;

  const stopDisabled = cell.status === "retired" || cell.status === "stopped" || stopMutation.isPending;
  const stopTooltip =
    cell.status === "retired"
      ? "Cell is retired."
      : cell.status === "stopped"
        ? "Cell is already stopped."
        : undefined;

  const showCreditCard = cell.has_failed_use || cell.status === "stopped";

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
            {cell.status === "stopped" && (
              <div>
                <span className={styles.label}>Stopped</span>
                <span className={styles.value}>{formatDateTime(cell.stopped_at)}</span>
              </div>
            )}
          </div>

          {cell.stopped_reason && (
            <Note tone="warn" icon="!">
              Stopped: {cell.stopped_reason}
            </Note>
          )}

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
            <span title={stopTooltip}>
              <Button variant="ghost" onClick={() => setStopModalOpen(true)} disabled={stopDisabled}>
                Stop cell
              </Button>
            </span>
          </div>
          {retireMutation.isError && (
            <Note tone="bad" icon="!">
              {retireMutation.error instanceof ApiError ? retireMutation.error.message : "Failed to retire cell."}
            </Note>
          )}
          {bumpedCount !== null && bumpedCount > 0 && (
            <Note tone="warn" icon="!">
              {bumpedCount} sample{bumpedCount === 1 ? "" : "s"} returned to backlog for rescheduling.
            </Note>
          )}
        </CardBody>
      </Card>

      {showCreditCard && (
        <Card>
          <CardHeader>
            <h2>PacBio credit</h2>
          </CardHeader>
          <CardBody>
            <div className={styles.creditGrid}>
              <div>
                <span className={styles.label}>Case number</span>
                <span className={styles.value}>{cell.pacbio_case_number ?? "—"}</span>
              </div>
              <div>
                <span className={styles.label}>Reported to PacBio</span>
                <span className={styles.value}>{formatDateTime(cell.pacbio_reported_at)}</span>
              </div>
              <div>
                <span className={styles.label}>Credit confirmed</span>
                <span className={styles.value}>{formatDateTime(cell.pacbio_credit_confirmed_at)}</span>
              </div>
              <div>
                <span className={styles.label}>Credit received</span>
                <span className={styles.value}>{formatDateTime(cell.credit_received_at)}</span>
              </div>
            </div>

            {!cell.pacbio_case_number ? (
              <div className={styles.creditActions}>
                <input
                  type="text"
                  className={styles.caseInput}
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  placeholder="Case number, e.g. CS-000123"
                />
                <Button
                  variant="primary"
                  onClick={() => reportMutation.mutate(caseNumber)}
                  disabled={!caseNumber.trim() || reportMutation.isPending}
                >
                  {reportMutation.isPending ? "Reporting…" : "Report to PacBio"}
                </Button>
              </div>
            ) : (
              <div className={styles.creditActions}>
                {!cell.pacbio_credit_confirmed_at && (
                  <Button
                    variant="ghost"
                    onClick={() => confirmCreditMutation.mutate()}
                    disabled={confirmCreditMutation.isPending}
                  >
                    {confirmCreditMutation.isPending ? "Confirming…" : "Confirm credit"}
                  </Button>
                )}
                {!cell.credit_received_at && (
                  <Button
                    variant="ghost"
                    onClick={() => receiveCreditMutation.mutate()}
                    disabled={receiveCreditMutation.isPending}
                  >
                    {receiveCreditMutation.isPending ? "Marking…" : "Mark credit received"}
                  </Button>
                )}
              </div>
            )}

            {reportMutation.isError && (
              <Note tone="bad" icon="!">
                {reportMutation.error instanceof ApiError ? reportMutation.error.message : "Failed to report to PacBio."}
              </Note>
            )}
            {confirmCreditMutation.isError && (
              <Note tone="bad" icon="!">
                {confirmCreditMutation.error instanceof ApiError
                  ? confirmCreditMutation.error.message
                  : "Failed to confirm credit."}
              </Note>
            )}
            {receiveCreditMutation.isError && (
              <Note tone="bad" icon="!">
                {receiveCreditMutation.error instanceof ApiError
                  ? receiveCreditMutation.error.message
                  : "Failed to mark credit received."}
              </Note>
            )}
          </CardBody>
        </Card>
      )}

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
                  <th>Actions</th>
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
                    <td>
                      {canRecordQcOutcome(u) && (
                        <div className={styles.useActions}>
                          <Button size="sm" variant="ghost" onClick={() => setFailTarget(u)}>
                            Mark Failed
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAbortTarget(u)}>
                            Mark Aborted
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {stopModalOpen && (
        <StopCellModal
          pending={stopMutation.isPending}
          error={stopMutation.error}
          onCancel={() => setStopModalOpen(false)}
          onConfirm={(reason) => stopMutation.mutate(reason)}
        />
      )}

      {failTarget && (
        <MarkFailedModal
          use={failTarget}
          pending={markFailedMutation.isPending}
          error={markFailedMutation.error}
          onCancel={() => setFailTarget(null)}
          onConfirm={(notes) => markFailedMutation.mutate({ useId: failTarget.id, notes })}
        />
      )}

      {abortTarget && (
        <MarkAbortedModal
          use={abortTarget}
          pending={markAbortedMutation.isPending}
          error={markAbortedMutation.error}
          onCancel={() => setAbortTarget(null)}
          onConfirm={(notes) => markAbortedMutation.mutate({ useId: abortTarget.id, notes })}
        />
      )}
    </div>
  );
}

interface StopCellModalProps {
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/** QC: take this physical cell permanently out of service. Cascades by cancelling every
 * not-yet-run ("planned") use and returning its sample to the backlog - already-run uses
 * are left untouched as history. */
function StopCellModal({ pending, error, onCancel, onConfirm }: StopCellModalProps) {
  const [reason, setReason] = useState("");

  return (
    <Modal onClose={pending ? () => {} : onCancel} title="Stop this cell?">
      <p className={styles.helper}>
        All of this cell&apos;s not-yet-run uses are cancelled and their samples returned to the backlog for
        rescheduling. Uses that already ran are kept as history. This cell will never be offered for reuse again.
      </p>
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Reason (optional)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. visible crack on tray" />
      </div>

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to stop cell."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(reason)} disabled={pending}>
          {pending ? "Stopping…" : "Stop cell"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

interface MarkFailedModalProps {
  use: CellUseHistoryOut;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
}

/** QC: this specific use produced no usable data. The cell itself stays open for its
 * remaining uses - only "Stop cell" takes the physical cell out of service. */
function MarkFailedModal({ use, pending, error, onCancel, onConfirm }: MarkFailedModalProps) {
  const [notes, setNotes] = useState("");

  return (
    <Modal onClose={pending ? () => {} : onCancel} title={`Mark ${use.well} (run #${use.cycle_id}) Failed?`}>
      <p className={styles.helper}>
        {use.sample_external_id ? `Sample ${use.sample_external_id} will be marked Failed and ` : "The sample will be marked Failed and "}
        can be requeued to the backlog from the Samples list. The cell remains open for its other uses.
      </p>
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no data produced" />
      </div>

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to mark use as failed."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(notes)} disabled={pending}>
          {pending ? "Saving…" : "Mark Failed"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

interface MarkAbortedModalProps {
  use: CellUseHistoryOut;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
}

/** QC: the run/instrument was the problem, not this sample or cell - unlike Mark Failed,
 * the sample goes straight back to the backlog for a fresh attempt with no separate
 * Requeue step. The cell remains open for its other uses. */
function MarkAbortedModal({ use, pending, error, onCancel, onConfirm }: MarkAbortedModalProps) {
  const [notes, setNotes] = useState("");

  return (
    <Modal onClose={pending ? () => {} : onCancel} title={`Mark ${use.well} (run #${use.cycle_id}) Aborted?`}>
      <p className={styles.helper}>
        {use.sample_external_id ? `Sample ${use.sample_external_id} will be returned` : "The sample will be returned"}{" "}
        straight to the backlog for rescheduling - no separate requeue step needed. Use this when the run itself
        was aborted (instrument fault, etc.), not when the cell or sample is at fault. The cell remains open for
        its other uses.
      </p>
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. instrument fault mid-run" />
      </div>

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to mark use as aborted."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(notes)} disabled={pending}>
          {pending ? "Saving…" : "Mark Aborted"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

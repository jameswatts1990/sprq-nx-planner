import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { TraySiblingList } from "@/components/cells/TraySiblingList";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import type { CellUseHistoryOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { canRecordQcOutcome, canUndoQcOutcome } from "@/utils/cellUseQc";
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

  const trayId = query.data?.tray_id ?? null;
  const trayQuery = useQuery({
    queryKey: ["cells", { tray_id: trayId }],
    queryFn: () => cellsApi.list({ tray_id: trayId as number, page_size: 10 }),
    enabled: trayId !== null,
  });

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [undoStopModalOpen, setUndoStopModalOpen] = useState(false);
  const [bumpedCount, setBumpedCount] = useState<number | null>(null);
  const [failTarget, setFailTarget] = useState<CellUseHistoryOut | null>(null);
  const [abortTarget, setAbortTarget] = useState<CellUseHistoryOut | null>(null);
  const [undoTarget, setUndoTarget] = useState<CellUseHistoryOut | null>(null);
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

  const undoQcMutation = useMutation({
    mutationFn: (useId: number) => cellUsesApi.undo(useId),
    onSuccess: () => {
      invalidateCell();
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      setUndoTarget(null);
    },
  });

  const undoStopMutation = useMutation({
    mutationFn: () => cellsApi.undoStop(id),
    onSuccess: () => {
      invalidateCell();
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      setUndoStopModalOpen(false);
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
  const showWindowMeter =
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader badge={<Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>}>
          <h2>{cell.code}</h2>
        </CardHeader>
        <CardBody>
          {cell.stopped_reason && (
            <Note tone="warn" icon="!">
              Stopped: {cell.stopped_reason}
            </Note>
          )}

          <div className={styles.headerGrid}>
            <div>
              <span className={styles.label}>Uses</span>
              <span className={styles.value}>
                {cell.uses_consumed} / {cell.max_uses} ({cell.uses_remaining} remaining)
              </span>
            </div>
            {!showWindowMeter && (
              <>
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
              </>
            )}
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

          {showWindowMeter && <WindowMeter windowHours={cell.window_hours_elapsed as number} />}

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
            {cell.status === "stopped" && (
              <Button variant="ghost" onClick={() => setUndoStopModalOpen(true)} disabled={undoStopMutation.isPending}>
                Undo stop
              </Button>
            )}
          </div>
          {retireMutation.isError && (
            <Note tone="bad" icon="!">
              {retireMutation.error instanceof ApiError ? retireMutation.error.message : "Failed to retire cell."}
            </Note>
          )}
          {undoStopMutation.isError && (
            <Note tone="bad" icon="!">
              {undoStopMutation.error instanceof ApiError ? undoStopMutation.error.message : "Failed to undo stop."}
            </Note>
          )}
          {bumpedCount !== null && bumpedCount > 0 && (
            <Note tone="warn" icon="!">
              {bumpedCount} sample{bumpedCount === 1 ? "" : "s"} returned to backlog for rescheduling.
            </Note>
          )}
        </CardBody>
      </Card>

      {trayId !== null && (
        <Card>
          <CardHeader>
            <h2>Cell tray</h2>
          </CardHeader>
          <CardBody>
            <p className={styles.helper}>
              SPRQ-Nx SMRT Cells ship in a tray of {cell.tray_size}. Once one cell in a tray is used, all{" "}
              {cell.tray_size} are registered together - the others below are real, reusable cells even before
              their own first use.
            </p>
            {trayQuery.isLoading ? (
              <div className={styles.status}>Loading tray…</div>
            ) : (
              <TraySiblingList cells={trayQuery.data?.items ?? []} currentCellId={cell.id} />
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
            <div className={styles.tableWrap}>
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
                        {(canRecordQcOutcome(u) || canUndoQcOutcome(u)) && (
                          <div className={styles.useActions}>
                            {canRecordQcOutcome(u) && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => setFailTarget(u)}>
                                  Mark Failed
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setAbortTarget(u)}>
                                  Mark Aborted
                                </Button>
                              </>
                            )}
                            {canUndoQcOutcome(u) && (
                              <Button size="sm" variant="ghost" onClick={() => setUndoTarget(u)}>
                                Undo {u.status === "failed" ? "Failed" : "Aborted"}
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {stopModalOpen && (
        <StopCellModal
          pending={stopMutation.isPending}
          error={stopMutation.error}
          onCancel={() => setStopModalOpen(false)}
          onConfirm={(reason) => stopMutation.mutate(reason)}
        />
      )}

      {undoStopModalOpen && (
        <UndoStopCellModal
          pending={undoStopMutation.isPending}
          error={undoStopMutation.error}
          onCancel={() => setUndoStopModalOpen(false)}
          onConfirm={() => undoStopMutation.mutate()}
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

      {undoTarget && (
        <UndoQcModal
          use={undoTarget}
          pending={undoQcMutation.isPending}
          error={undoQcMutation.error}
          onCancel={() => setUndoTarget(null)}
          onConfirm={() => undoQcMutation.mutate(undoTarget.id)}
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
    <ConfirmModal
      title="Stop this cell?"
      confirmLabel="Stop cell"
      pendingLabel="Stopping…"
      pending={pending}
      error={error != null ? (error instanceof ApiError ? error.message : "Failed to stop cell.") : null}
      textarea={{
        label: "Reason (optional)",
        value: reason,
        onChange: setReason,
        placeholder: "e.g. visible crack on tray",
      }}
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason)}
    >
      <p className={styles.helper}>
        All of this cell&apos;s not-yet-run uses are cancelled and their samples returned to the backlog for
        rescheduling. Uses that already ran are kept as history. This cell will never be offered for reuse again.
      </p>
    </ConfirmModal>
  );
}

interface UndoStopCellModalProps {
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Reverse a mistaken Stop cell - reopens the cell and restores every use it cancelled
 * back to Planned. Only use this if the wrong physical cell was stopped; if this cell
 * genuinely needs to stay out of service, leave it stopped. */
function UndoStopCellModal({ pending, error, onCancel, onConfirm }: UndoStopCellModalProps) {
  return (
    <ConfirmModal
      title="Undo Stop cell?"
      confirmLabel="Undo stop"
      pendingLabel="Undoing…"
      pending={pending}
      error={error != null ? (error instanceof ApiError ? error.message : "Failed to undo stop.") : null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <Note tone="warn" icon="!">
        This reopens the cell and restores every use it cancelled back to Planned. Only do this if the wrong
        physical cell was stopped by mistake.
      </Note>
    </ConfirmModal>
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
    <ConfirmModal
      title={`Mark ${use.well} (run #${use.cycle_id}) Failed?`}
      confirmLabel="Mark Failed"
      pendingLabel="Saving…"
      pending={pending}
      error={error != null ? (error instanceof ApiError ? error.message : "Failed to mark use as failed.") : null}
      textarea={{
        label: "Notes (optional)",
        value: notes,
        onChange: setNotes,
        placeholder: "e.g. no data produced",
      }}
      onCancel={onCancel}
      onConfirm={() => onConfirm(notes)}
    >
      <p className={styles.helper}>
        {use.sample_external_id ? `Sample ${use.sample_external_id} will be marked Failed and ` : "The sample will be marked Failed and "}
        can be requeued to the backlog from the Samples list. The cell remains open for its other uses.
      </p>
    </ConfirmModal>
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
    <ConfirmModal
      title={`Mark ${use.well} (run #${use.cycle_id}) Aborted?`}
      confirmLabel="Mark Aborted"
      pendingLabel="Saving…"
      pending={pending}
      error={error != null ? (error instanceof ApiError ? error.message : "Failed to mark use as aborted.") : null}
      textarea={{
        label: "Notes (optional)",
        value: notes,
        onChange: setNotes,
        placeholder: "e.g. instrument fault mid-run",
      }}
      onCancel={onCancel}
      onConfirm={() => onConfirm(notes)}
    >
      <p className={styles.helper}>
        {use.sample_external_id ? `Sample ${use.sample_external_id} will be returned` : "The sample will be returned"}{" "}
        straight to the backlog for rescheduling - no separate requeue step needed. Use this when the run itself
        was aborted (instrument fault, etc.), not when the cell or sample is at fault. The cell remains open for
        its other uses.
      </p>
    </ConfirmModal>
  );
}

interface UndoQcModalProps {
  use: CellUseHistoryOut;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Reverse a mistaken Mark Failed/Mark Aborted verdict on this specific use, restoring it
 * (and its sample) to how they looked beforehand. Only use this if the wrong slot was
 * flagged by mistake - if this cell genuinely failed or was aborted, leave the verdict as
 * is. The backend still has the final say - it 409s if the sample has since moved on
 * (requeued or rescheduled), which surfaces here as the error note below. */
function UndoQcModal({ use, pending, error, onCancel, onConfirm }: UndoQcModalProps) {
  const verdict = use.status === "failed" ? "Failed" : "Aborted";

  return (
    <ConfirmModal
      title={`Undo ${use.well} (run #${use.cycle_id}) ${verdict}?`}
      confirmLabel="Undo"
      pendingLabel="Undoing…"
      pending={pending}
      error={error != null ? (error instanceof ApiError ? error.message : "Failed to undo.") : null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <Note tone="warn" icon="!">
        This restores this placement to its previous state, ready to run again. Only do this if the wrong slot was
        flagged by mistake - if this cell genuinely {use.status === "failed" ? "failed" : "was aborted"}, leave the
        verdict as is.
      </Note>
    </ConfirmModal>
  );
}

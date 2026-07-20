import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { CycleOut, StageOut } from "@/types/schedule";
import type { CellChoice } from "@/types/schedulerGrid";
import { canRecordQcOutcome, canUndoQcOutcome } from "@/utils/cellUseQc";
import { runLabel } from "@/utils/runLabel";

import { useCompatibleCells } from "./useCompatibleCells";
import styles from "./SlotDetailPopover.module.css";

export interface SlotDetailPopoverProps {
  stage: StageOut;
  /** The owning run is confirmed/locked - hide the Remove/Change cell actions. */
  locked: boolean;
  instrumentSerial: string;
  /** The run this slot belongs to - drives the Run ID row. */
  cycle: CycleOut;
  onClose: () => void;
  onRemoved: () => void;
}

/** Which of the popover's alternate inline views is showing, in place of the normal
 * detail + footer. Mutually exclusive, so a single field rather than several booleans. */
type PopoverMode = "view" | "changeCell" | "markFailed" | "markAborted" | "stop" | "undoQc" | "undoStop";

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample. When
 * the run is still "planned" (unlocked), offers "Unschedule" and "Change cell" (swap this
 * placement onto a different open cell, or a brand-new one, without touching its
 * day/slot - the orthogonal counterpart to dragging it to a new slot, which keeps the
 * cell fixed). Also offers the same QC quick actions as the Cell detail page, surfaced
 * top-right next to the title rather than buried in the body - Mark Failed and Mark
 * Aborted (this use only) and Stop cell (the whole physical cell), coloured red since
 * each takes something out of service, plus their neutral-toned Undo counterparts for a
 * mistaken verdict - so a problem spotted while browsing the grid doesn't require a
 * detour to that page. Built on Modal; folds in the old CellCard's cell-context display. */
export function SlotDetailPopover({ stage, locked, instrumentSerial, cycle, onClose, onRemoved }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PopoverMode>("view");
  const [selected, setSelected] = useState<string>("new"); // "new" | "<cellId>"
  const [failNotes, setFailNotes] = useState("");
  const [abortNotes, setAbortNotes] = useState("");
  const [stopReason, setStopReason] = useState("");

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  const { cellsQuery: compatibleQuery, compatible } = useCompatibleCells({
    instrumentSerial,
    sampleBarcodes: stage.barcodes,
    excludeCellId: stage.cell_id,
    targetWell: stage.well,
    enabled: mode === "changeCell",
  });

  function invalidateAfterQcAction() {
    void queryClient.invalidateQueries({ queryKey: ["cycles"] });
    void queryClient.invalidateQueries({ queryKey: ["cells"] });
    void queryClient.invalidateQueries({ queryKey: ["samples"] });
  }

  const removeMutation = useMutation({
    mutationFn: () => cellUsesApi.remove(stage.cell_use_id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      onRemoved();
    },
  });

  const changeCellMutation = useMutation({
    mutationFn: () => {
      const cellChoice: CellChoice =
        selected === "new" ? { mode: "new" } : { mode: "existing", cell_id: Number(selected) };
      return cellUsesApi.changeCell(stage.cell_use_id, { cell_choice: cellChoice });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      // Unlike Remove, this placement still exists (same slot, same selection state) -
      // just close so the grid behind shows the swapped cell, rather than reusing
      // onRemoved and disturbing any bulk-selection the user had on this slot.
      onClose();
    },
  });

  const markFailedMutation = useMutation({
    mutationFn: () => cellUsesApi.updateStatus(stage.cell_use_id, { status: "failed", notes: failNotes || undefined }),
    onSuccess: () => {
      invalidateAfterQcAction();
      // The placement itself is untouched (same slot, same cell) - just the use's status
      // flips, so close rather than onRemoved(), same reasoning as changeCellMutation.
      onClose();
    },
  });

  const markAbortedMutation = useMutation({
    mutationFn: () => cellUsesApi.updateStatus(stage.cell_use_id, { status: "aborted", notes: abortNotes || undefined }),
    onSuccess: () => {
      // Same reasoning as markFailedMutation - the placement/history is untouched, only
      // the sample (now back in the backlog) needs its own list refreshed too.
      invalidateAfterQcAction();
      onClose();
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => cellsApi.stop(stage.cell_id, { reason: stopReason || null }),
    onSuccess: () => {
      invalidateAfterQcAction();
      // The placement itself is untouched by Stop cell now: a still-"planned" use is
      // cancelled in place (kept as a visible, blocked slot) rather than removed, and an
      // already-run use's history is untouched either way - so just close in both cases.
      onClose();
    },
  });

  const undoQcMutation = useMutation({
    mutationFn: () => cellUsesApi.undo(stage.cell_use_id),
    onSuccess: () => {
      invalidateAfterQcAction();
      onClose();
    },
  });

  const undoStopMutation = useMutation({
    mutationFn: () => cellsApi.undoStop(stage.cell_id),
    onSuccess: () => {
      invalidateAfterQcAction();
      onClose();
    },
  });

  const cell = cellQuery.data;
  const currentUse = cell?.use_history.find((u) => u.id === stage.cell_use_id);
  const canFlagQc = !!currentUse && canRecordQcOutcome(currentUse);
  const canUndoQc = !!currentUse && canUndoQcOutcome(currentUse);
  const stopDisabled = !cell || cell.status === "retired" || cell.status === "stopped";
  const canUndoStop = !!cell && cell.status === "stopped";
  const isCancelled = stage.cell_use_status === "cancelled";
  const showWindowMeter =
    !!cell &&
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;

  const showQc = mode === "view" && (canFlagQc || canUndoQc || !stopDisabled || canUndoStop);
  const qcActions = showQc && (
    <div className={styles.qcButtons}>
      {canFlagQc && (
        <Button size="sm" variant="danger" onClick={() => setMode("markFailed")}>
          Mark Failed
        </Button>
      )}
      {canFlagQc && (
        <Button size="sm" variant="danger" onClick={() => setMode("markAborted")}>
          Mark Aborted
        </Button>
      )}
      {canUndoQc && (
        <Button size="sm" variant="ghost" onClick={() => setMode("undoQc")}>
          Undo {currentUse?.status === "failed" ? "Failed" : "Aborted"}
        </Button>
      )}
      {!stopDisabled && (
        <Button size="sm" variant="danger" onClick={() => setMode("stop")}>
          Stop cell
        </Button>
      )}
      {canUndoStop && (
        <Button size="sm" variant="ghost" onClick={() => setMode("undoStop")}>
          Undo stop
        </Button>
      )}
    </div>
  );

  return (
    <Modal onClose={onClose} title={stage.cell_ref} titleExtra={qcActions || undefined}>
      {isCancelled && (
        <Note tone="warn" icon="!">
          This placement was cancelled{cell?.stopped_reason ? ` when its cell was stopped: ${cell.stopped_reason}` : " when its cell was stopped"} before it could run. Its sample was returned to the Backlog and can be rescheduled elsewhere.
        </Note>
      )}
      <div className={styles.row}>
        <span className={styles.label}>Sample</span>
        <b className={styles.value}>{stage.sample_external_id ?? "—"}</b>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Well</span>
        <b className={styles.value}>{stage.well}</b>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Run</span>
        <b className={styles.value}>{runLabel(cycle)}</b>
      </div>
      {cell && (
        <div className={styles.row}>
          <span className={styles.label}>Cell uses</span>
          <b className={styles.value}>
            {cell.uses_consumed}/{cell.max_uses}
            {cell.current_instrument_serial ? ` · ${cell.current_instrument_serial}` : ""}
          </b>
        </div>
      )}

      {showWindowMeter && <WindowMeter windowHours={cell!.window_hours_elapsed as number} />}

      <div className={styles.barcodes}>
        <span className={styles.label}>Barcodes on this use</span>
        <BarcodeChips barcodes={stage.barcodes} />
      </div>

      {cell && cell.burned_barcodes.length > 0 && (
        <div className={styles.barcodes}>
          <span className={styles.label}>Burned on cell</span>
          <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
        </div>
      )}

      {mode === "markFailed" && (
        <div className={styles.qcForm}>
          <p className={styles.helper}>
            This use will be marked Failed and its sample can be requeued to the backlog. The cell stays open for
            its other uses.
          </p>
          <textarea
            className={styles.qcTextarea}
            value={failNotes}
            onChange={(e) => setFailNotes(e.target.value)}
            placeholder="Notes (optional), e.g. no data produced"
          />
        </div>
      )}

      {mode === "markAborted" && (
        <div className={styles.qcForm}>
          <p className={styles.helper}>
            This use will be marked Aborted and its sample goes straight back to the backlog for rescheduling - no
            separate requeue step. Use this when the run/instrument was the problem, not the cell or sample. The
            cell stays open for its other uses.
          </p>
          <textarea
            className={styles.qcTextarea}
            value={abortNotes}
            onChange={(e) => setAbortNotes(e.target.value)}
            placeholder="Notes (optional), e.g. instrument fault mid-run"
          />
        </div>
      )}

      {mode === "stop" && (
        <div className={styles.qcForm}>
          <p className={styles.helper}>
            All of this cell&apos;s not-yet-run uses are cancelled and their samples returned to the backlog. Uses
            that already ran are kept as history. This cell will never be offered for reuse again.
          </p>
          <textarea
            className={styles.qcTextarea}
            value={stopReason}
            onChange={(e) => setStopReason(e.target.value)}
            placeholder="Reason (optional), e.g. visible crack on tray"
          />
        </div>
      )}

      {mode === "undoQc" && (
        <Note tone="warn" icon="!">
          This will undo the <b>{currentUse?.status === "failed" ? "Failed" : "Aborted"}</b> verdict and restore
          this placement to its previous state, ready to run again. Only do this if the wrong slot was flagged by
          mistake - if this cell genuinely {currentUse?.status === "failed" ? "failed" : "was aborted"}, leave it
          as is.
        </Note>
      )}

      {mode === "undoStop" && (
        <Note tone="warn" icon="!">
          This will reopen the cell and restore every use it cancelled back to Planned. Only do this if the wrong
          physical cell was stopped by mistake - if this cell genuinely needs to stay out of service, leave it
          stopped.
        </Note>
      )}

      {mode === "changeCell" && (
        <fieldset className={styles.choices}>
          <legend className={styles.legend}>Change to</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="changeCellChoice"
              value="new"
              checked={selected === "new"}
              onChange={() => setSelected("new")}
            />
            <span className={styles.choiceMain}>Use a new cell</span>
          </label>

          {compatibleQuery.isError && (
            <Note tone="bad" icon="!">
              {compatibleQuery.error instanceof ApiError ? compatibleQuery.error.message : "Failed to load open cells."}
            </Note>
          )}
          {!compatibleQuery.isLoading && !compatibleQuery.isError && compatible.length === 0 && (
            <div className={styles.status}>No other reusable cells in use on {instrumentSerial}.</div>
          )}

          {compatible.map((c) => (
            <label key={c.id} className={styles.choice}>
              <input
                type="radio"
                name="changeCellChoice"
                value={String(c.id)}
                checked={selected === String(c.id)}
                onChange={() => setSelected(String(c.id))}
              />
              <span className={styles.choiceMain}>
                <span className={styles.code}>{c.code}</span>
                <span className={styles.meta}>
                  {c.uses_consumed}/{c.max_uses} uses
                  {c.current_instrument_serial ? ` · ${c.current_instrument_serial}` : ""}
                </span>
              </span>
              <BarcodeChips barcodes={c.burned_barcodes} variant="u2" />
            </label>
          ))}
        </fieldset>
      )}

      {changeCellMutation.isError && (
        <Note tone="bad" icon="!">
          {changeCellMutation.error instanceof ApiError ? changeCellMutation.error.message : "Failed to change cell."}
        </Note>
      )}

      {removeMutation.isError && (
        <Note tone="bad" icon="!">
          {removeMutation.error instanceof ApiError ? removeMutation.error.message : "Failed to remove placement."}
        </Note>
      )}

      {markFailedMutation.isError && (
        <Note tone="bad" icon="!">
          {markFailedMutation.error instanceof ApiError
            ? markFailedMutation.error.message
            : "Failed to mark use as failed."}
        </Note>
      )}

      {markAbortedMutation.isError && (
        <Note tone="bad" icon="!">
          {markAbortedMutation.error instanceof ApiError
            ? markAbortedMutation.error.message
            : "Failed to mark use as aborted."}
        </Note>
      )}

      {stopMutation.isError && (
        <Note tone="bad" icon="!">
          {stopMutation.error instanceof ApiError ? stopMutation.error.message : "Failed to stop cell."}
        </Note>
      )}

      {undoQcMutation.isError && (
        <Note tone="bad" icon="!">
          {undoQcMutation.error instanceof ApiError ? undoQcMutation.error.message : "Failed to undo."}
        </Note>
      )}

      {undoStopMutation.isError && (
        <Note tone="bad" icon="!">
          {undoStopMutation.error instanceof ApiError ? undoStopMutation.error.message : "Failed to undo stop."}
        </Note>
      )}

      <ModalActions>
        <Button
          variant="ghost"
          onClick={mode === "view" ? onClose : () => setMode("view")}
          disabled={
            removeMutation.isPending ||
            changeCellMutation.isPending ||
            markFailedMutation.isPending ||
            markAbortedMutation.isPending ||
            stopMutation.isPending ||
            undoQcMutation.isPending ||
            undoStopMutation.isPending
          }
        >
          {mode === "view" ? "Close" : "Cancel"}
        </Button>
        <Link to={`/cells/${stage.cell_id}`} className={`btn primary sm ${styles.viewCellLink}`}>
          View cell →
        </Link>
        {mode === "changeCell" && (
          <Button variant="primary" onClick={() => changeCellMutation.mutate()} disabled={changeCellMutation.isPending}>
            {changeCellMutation.isPending ? "Changing…" : "Confirm change"}
          </Button>
        )}
        {mode === "markFailed" && (
          <Button variant="primary" onClick={() => markFailedMutation.mutate()} disabled={markFailedMutation.isPending}>
            {markFailedMutation.isPending ? "Saving…" : "Mark Failed"}
          </Button>
        )}
        {mode === "markAborted" && (
          <Button variant="primary" onClick={() => markAbortedMutation.mutate()} disabled={markAbortedMutation.isPending}>
            {markAbortedMutation.isPending ? "Saving…" : "Mark Aborted"}
          </Button>
        )}
        {mode === "stop" && (
          <Button variant="primary" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
            {stopMutation.isPending ? "Stopping…" : "Stop cell"}
          </Button>
        )}
        {mode === "undoQc" && (
          <Button variant="primary" onClick={() => undoQcMutation.mutate()} disabled={undoQcMutation.isPending}>
            {undoQcMutation.isPending ? "Undoing…" : "Undo"}
          </Button>
        )}
        {mode === "undoStop" && (
          <Button variant="primary" onClick={() => undoStopMutation.mutate()} disabled={undoStopMutation.isPending}>
            {undoStopMutation.isPending ? "Undoing…" : "Undo stop"}
          </Button>
        )}
        {!locked && !isCancelled && mode === "view" && (
          <>
            <Button variant="ghost" onClick={() => setMode("changeCell")}>
              Change cell
            </Button>
            <Button variant="danger" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
              {removeMutation.isPending ? "Removing…" : "Unschedule"}
            </Button>
          </>
        )}
      </ModalActions>
    </Modal>
  );
}

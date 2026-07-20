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
import { canRecordQcOutcome, canUndoQcOutcome } from "@/utils/cellUseQc";
import { runLabel } from "@/utils/runLabel";

import styles from "./SlotDetailPopover.module.css";

export interface SlotDetailPopoverProps {
  stage: StageOut;
  /** The run this slot belongs to - drives the Run ID row. */
  cycle: CycleOut;
  onClose: () => void;
}

/** Which of the popover's alternate inline views is showing, in place of the normal
 * detail + footer. Mutually exclusive, so a single field rather than several booleans. */
type PopoverMode = "view" | "markFailed" | "stop" | "undoQc" | "undoStop";

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample. A cell
 * is physically fixed to its tray/well position for life, so this popover never offers a
 * way to reassign it in place - reallocating a sample means dragging it to a different
 * slot (it adopts whatever cell already lives there) or off the grid entirely to
 * unschedule it back to Backlog, both handled by the grid's drag-and-drop. What this
 * popover does offer is the same QC quick actions as the Cell detail page, surfaced
 * top-right next to the title rather than buried in the body - Mark Failed (this use
 * only) and Stop cell (this use, plus the whole physical cell for reuse), coloured red
 * since each takes something out of service, plus their neutral-toned Undo counterparts
 * for a mistaken verdict - so a problem spotted while browsing the grid doesn't require a
 * detour to that page. Built on Modal; folds in the old CellCard's cell-context display. */
export function SlotDetailPopover({ stage, cycle, onClose }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PopoverMode>("view");
  const [failNotes, setFailNotes] = useState("");
  const [stopReason, setStopReason] = useState("");

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  function invalidateAfterQcAction() {
    void queryClient.invalidateQueries({ queryKey: ["cycles"] });
    void queryClient.invalidateQueries({ queryKey: ["cells"] });
    void queryClient.invalidateQueries({ queryKey: ["samples"] });
  }

  const markFailedMutation = useMutation({
    mutationFn: () => cellUsesApi.updateStatus(stage.cell_use_id, { status: "failed", notes: failNotes || undefined }),
    onSuccess: () => {
      invalidateAfterQcAction();
      // The placement itself is untouched (same slot, same cell) - just the use's status
      // flips, so close is enough; nothing else needs to react.
      onClose();
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => cellsApi.stop(stage.cell_id, { reason: stopReason || null, cell_use_id: stage.cell_use_id }),
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
  // Drives both Mark Failed and Stop cell - they always appear/disappear together, once
  // this use's run is locked in and it hasn't already recorded a terminal outcome. A
  // stopped/retired cell's own uses are already terminal by construction, so no separate
  // cell-status check is needed to hide Stop there.
  const canFlagQc = !!currentUse && canRecordQcOutcome(currentUse);
  const canUndoQc = !!currentUse && canUndoQcOutcome(currentUse);
  const canUndoStop = !!cell && cell.status === "stopped";
  const isCancelled = stage.cell_use_status === "cancelled";
  const showWindowMeter =
    !!cell &&
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;

  const showQc = mode === "view" && (canFlagQc || canUndoQc || canUndoStop);
  const qcActions = showQc && (
    <div className={styles.qcButtons}>
      {canFlagQc && (
        <Button size="sm" variant="danger" onClick={() => setMode("markFailed")}>
          Mark Failed
        </Button>
      )}
      {canUndoQc && (
        <Button size="sm" variant="ghost" onClick={() => setMode("undoQc")}>
          Undo {currentUse?.status === "failed" ? "Failed" : "Aborted"}
        </Button>
      )}
      {canFlagQc && (
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

      {mode === "stop" && (
        <div className={styles.qcForm}>
          <p className={styles.helper}>
            This sample counts as Failed - no usable data was produced, so you&apos;ll need to raise a PacBio credit
            case for it. The cell is taken out of service: any later still-planned uses on it are cancelled and
            their samples returned to the Backlog flagged <b>Aborted</b>, ready to be rescued onto a different cell.
            Earlier uses that already ran are kept as history, untouched.
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

      {markFailedMutation.isError && (
        <Note tone="bad" icon="!">
          {markFailedMutation.error instanceof ApiError
            ? markFailedMutation.error.message
            : "Failed to mark use as failed."}
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
            markFailedMutation.isPending ||
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
        {mode === "markFailed" && (
          <Button variant="primary" onClick={() => markFailedMutation.mutate()} disabled={markFailedMutation.isPending}>
            {markFailedMutation.isPending ? "Saving…" : "Mark Failed"}
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
      </ModalActions>
    </Modal>
  );
}

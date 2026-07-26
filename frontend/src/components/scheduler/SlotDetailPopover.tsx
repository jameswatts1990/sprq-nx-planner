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
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { RunOut, RunTimeHours, StageOut } from "@/types/schedule";
import { canRecordQcOutcome, canUndoQcOutcome } from "@/utils/cellUseQc";
import { plateWellFromSlot } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";

import styles from "./SlotDetailPopover.module.css";

const RUN_TIME_OPTIONS = [
  { value: 12 as RunTimeHours, label: "12 h" },
  { value: 24 as RunTimeHours, label: "24 h" },
  { value: 30 as RunTimeHours, label: "30 h" },
];

export interface SlotDetailPopoverProps {
  stage: StageOut;
  /** The run this slot belongs to - drives the Run ID row. */
  run: RunOut;
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
export function SlotDetailPopover({ stage, run, onClose }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PopoverMode>("view");
  const [failNotes, setFailNotes] = useState("");
  const [stopReason, setStopReason] = useState("");
  // Editable placement note. `savedNotes` tracks the last persisted value so the Save
  // button can tell dirty from clean - the `stage` prop is captured at click time and
  // isn't refreshed in place after the mutation, so we can't compare against it.
  const [notes, setNotes] = useState(stage.notes ?? "");
  const [savedNotes, setSavedNotes] = useState(stage.notes ?? "");
  // Per-cell run time. Like notes, `stage` is captured at click time, so track the shown
  // value locally; `savedRunTime` is the last value the server accepted, to revert to on
  // error. Editing changes only THIS well - the run's overall movie time follows its
  // longest well (recomputed server-side), so the grid may show a new run duration after.
  const [runTime, setRunTime] = useState<RunTimeHours>(stage.run_time_hours);
  const [savedRunTime, setSavedRunTime] = useState<RunTimeHours>(stage.run_time_hours);

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  function invalidateAfterQcAction() {
    invalidateScheduleRelated(queryClient);
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

  // Not gated by the cycle lock - a note stays editable after the run is confirmed. Keep
  // the popover open on save (unlike the QC actions) so the user can keep editing; just
  // refresh the grid/batch sheet and update the saved baseline.
  const saveNotesMutation = useMutation({
    mutationFn: () => cellUsesApi.updateNotes(stage.cell_use_id, notes),
    onSuccess: () => {
      setSavedNotes(notes);
      invalidateScheduleRelated(queryClient);
    },
  });
  const notesDirty = notes !== savedNotes;

  // Editing a single cell's run time. Fires immediately on selection (no separate Save) -
  // the server recomputes the run's representative movie time and returns the fresh cycle,
  // so the grid/batch sheet pick up any new duration. On error, revert to the last accepted
  // value so the control never shows an unsaved state.
  const runTimeMutation = useMutation({
    mutationFn: (v: RunTimeHours) => cellUsesApi.updateRunTime(stage.cell_use_id, v),
    onSuccess: (_data, v) => {
      setSavedRunTime(v);
      invalidateScheduleRelated(queryClient);
    },
    onError: () => setRunTime(savedRunTime),
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

  // Recover a slot left "Blocked" by a tray/cell discard: delete the dead placement and
  // return its sample to the Backlog. Only offered for a discard-origin block (see
  // isDiscardBlocked); a Stop-origin block is a permanent QC marker and is reversed with
  // Undo stop instead.
  const returnToBacklogMutation = useMutation({
    mutationFn: () => cellUsesApi.returnToBacklog(stage.cell_use_id),
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
  // Run time is a planning dial: editable only while the run and this placement are both
  // still planned (mirrors the backend guard in update_cell_use_run_time). Once locked, the
  // movie time is what the instrument actually acquired, so it's shown read-only.
  const canEditRunTime = run.status === "planned" && stage.cell_use_status === "planned";
  // A "Blocked" slot that came from a discard (not a QC Stop) - recoverable back to the
  // Backlog. Told apart by the cell's discarded_at, which only a discard ever sets.
  const isDiscardBlocked = isCancelled && !!cell?.discarded_at;
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
          {isDiscardBlocked ? (
            <>
              This placement was cancelled when its tray was discarded, so it shows as <b>Blocked</b>. Its sample is
              back in the Backlog — use <b>Return to backlog</b> below to clear this stuck slot from the schedule.
            </>
          ) : (
            <>
              This placement was cancelled
              {cell?.stopped_reason ? ` when its cell was stopped: ${cell.stopped_reason}` : " when its cell was stopped"} before
              it could run. Its sample was returned to the Backlog and can be rescheduled elsewhere.
            </>
          )}
        </Note>
      )}
      <div className={styles.details}>
        <div className={styles.row}>
          <span className={styles.label}>Sample</span>
          <b className={styles.value}>{stage.sample_external_id ?? "—"}</b>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Well</span>
          <b className={styles.value}>{plateWellFromSlot(stage.slot_index, { full: true })}</b>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Run</span>
          <b className={styles.value}>{runLabel(run)}</b>
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
        <div className={`${styles.row} ${styles.runTimeRow}`}>
          <span className={styles.label}>Run time</span>
          {mode === "view" && canEditRunTime ? (
            <SegmentedControl
              ariaLabel="Run time for this cell"
              options={RUN_TIME_OPTIONS}
              value={runTime}
              onChange={(v) => {
                setRunTime(v);
                runTimeMutation.mutate(v);
              }}
            />
          ) : (
            <b className={styles.value}>{runTime} h</b>
          )}
        </div>
      </div>

      {mode === "view" && runTimeMutation.isError && (
        <Note tone="bad" icon="!">
          {runTimeMutation.error instanceof ApiError ? runTimeMutation.error.message : "Failed to change run time."}
        </Note>
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

      {mode === "view" && (
        <div className={styles.notes}>
          <span className={styles.label}>Notes</span>
          <textarea
            className={styles.qcTextarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note for this sample on this cell…"
          />
          <div className={styles.notesActions}>
            {saveNotesMutation.isError && (
              <span className={styles.notesError}>
                {saveNotesMutation.error instanceof ApiError ? saveNotesMutation.error.message : "Failed to save note."}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => saveNotesMutation.mutate()}
              disabled={!notesDirty || saveNotesMutation.isPending}
            >
              {saveNotesMutation.isPending ? "Saving…" : notesDirty ? "Save note" : "Saved"}
            </Button>
          </div>
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

      {returnToBacklogMutation.isError && (
        <Note tone="bad" icon="!">
          {returnToBacklogMutation.error instanceof ApiError
            ? returnToBacklogMutation.error.message
            : "Failed to return to backlog."}
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
            undoStopMutation.isPending ||
            returnToBacklogMutation.isPending
          }
        >
          {mode === "view" ? "Close" : "Cancel"}
        </Button>
        <Link to={`/cells/${stage.cell_id}`} className={`btn primary sm ${styles.viewCellLink}`}>
          View cell →
        </Link>
        {mode === "view" && isDiscardBlocked && (
          <Button
            variant="primary"
            onClick={() => returnToBacklogMutation.mutate()}
            disabled={returnToBacklogMutation.isPending}
          >
            {returnToBacklogMutation.isPending ? "Returning…" : "Return to backlog"}
          </Button>
        )}
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

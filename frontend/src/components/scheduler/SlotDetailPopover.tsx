import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { samplesApi } from "@/api/samples";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { RunStageGantt } from "@/components/scheduler/RunStageGantt";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import { SampleModal } from "@/pages/SampleModal";
import type { RunOut, RunTimeHours, StageOut } from "@/types/schedule";
import { plateWellFromSlot } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";

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
  /** Open the shared Cell QC modal for this slot's physical cell (anchored on this use). */
  onOpenQc: (cellId: number, cellUseId: number) => void;
}

/** The only sample fields still editable once a sample has been placed on the grid — its
 * loading/annotation parameters. Barcodes, Sanger IDs, parent, and the Container ID are
 * frozen at placement (the barcodes are burned onto the cell use; the backend enforces this
 * too — see update_placed_sample_metadata). Keys match the importable-field set. */
const PLACED_EDITABLE_KEYS = new Set([
  "target_oplc",
  "actual_oplc",
  "cleaned_complex_volume",
  "loading_buffer_volume",
  "adaptive_loading",
  "full_resolution_base_q",
  "priority",
  "base_kinetics",
]);

/** Cell-use statuses whose sample is done/gone, so its record is read-only history. Used as
 * a cheap, no-fetch gate on whether the Sample value is shown as an edit link. */
const SAMPLE_LOCKED_USE_STATUSES = ["completed", "failed", "cancelled"];

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample, its
 * per-cell run time and a free-text note. A cell is physically fixed to its tray/well
 * position for life, so this popover never reassigns it in place - reallocating a sample
 * means dragging it. Cell QC (Fail / Fail-and-Stop / Retire) lives in the shared Cell QC
 * modal, reachable from here via the "Cell QC" button (and from the card's ticket-stub / the tray
 * overview); it isn't duplicated inline any more. Built on Modal. */
export function SlotDetailPopover({ stage, run, onClose, onOpenQc }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const backNav = useSampleBackNav();
  // Editable placement note. `savedNotes` tracks the last persisted value so the Save button
  // can tell dirty from clean - the `stage` prop is captured at click time and isn't refreshed
  // in place after the mutation.
  const [notes, setNotes] = useState(stage.notes ?? "");
  const [savedNotes, setSavedNotes] = useState(stage.notes ?? "");
  const [runTime, setRunTime] = useState<RunTimeHours>(stage.run_time_hours);
  const [savedRunTime, setSavedRunTime] = useState<RunTimeHours>(stage.run_time_hours);

  const [editingSample, setEditingSample] = useState(false);
  const sampleQuery = useQuery({
    queryKey: ["sample", stage.sample_id],
    queryFn: () => samplesApi.get(stage.sample_id as number),
    enabled: editingSample && stage.sample_id != null,
  });
  const sampleEditable = stage.sample_id != null && !SAMPLE_LOCKED_USE_STATUSES.includes(stage.cell_use_status);

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  const saveNotesMutation = useMutation({
    mutationFn: () => cellUsesApi.updateNotes(stage.cell_use_id, notes),
    onSuccess: () => {
      setSavedNotes(notes);
      invalidateScheduleRelated(queryClient);
    },
  });
  const notesDirty = notes !== savedNotes;

  const runTimeMutation = useMutation({
    mutationFn: (v: RunTimeHours) => cellUsesApi.updateRunTime(stage.cell_use_id, v),
    onSuccess: (_data, v) => {
      setSavedRunTime(v);
      invalidateScheduleRelated(queryClient);
    },
    onError: () => setRunTime(savedRunTime),
  });

  // Recover a slot left "Blocked" by a tray/cell discard: delete the dead placement and
  // return its sample to the Backlog. Only offered for a discard-origin block; a QC-origin
  // block is a permanent marker, reversed via the Cell QC modal's Undo instead.
  const returnToBacklogMutation = useMutation({
    mutationFn: () => cellUsesApi.returnToBacklog(stage.cell_use_id),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      onClose();
    },
  });

  const cell = cellQuery.data;
  const isCancelled = stage.cell_use_status === "cancelled";
  const canEditRunTime = run.status === "planned" && stage.cell_use_status === "planned";
  const isDiscardBlocked = isCancelled && !!cell?.discarded_at;
  const showWindowMeter =
    !!cell &&
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;

  if (editingSample && sampleQuery.data) {
    return (
      <SampleModal
        sample={sampleQuery.data}
        editableKeys={PLACED_EDITABLE_KEYS}
        onClose={() => setEditingSample(false)}
        onSaved={() => invalidateScheduleRelated(queryClient)}
      />
    );
  }

  return (
    // Titled by the SAMPLE (Container ID) - the card-body popover is about this placement,
    // so it reads differently from the cell-stub popover (CellInfoPopover), which stays
    // titled by the physical cell code. The cell it ran on is shown as a subtitle for context.
    <Modal onClose={onClose} title={stage.sample_external_id ?? "Placement"}>
      <div className={styles.subtitle}>
        on cell {stage.cell_ref} · {plateWellFromSlot(stage.slot_index, { full: true })}
      </div>
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
              {cell?.stopped_reason ? ` when its cell was stopped: ${cell.stopped_reason}` : " by a Cell QC action"} before
              it could run. Its sample was routed to the backlog or a top-up.
            </>
          )}
        </Note>
      )}
      {(stage.reassigned || stage.barcode_clash) && (
        <Note tone={stage.barcode_clash ? "bad" : "warn"} icon="!">
          This sample <b>ran on a different cell than planned</b> after a Cell QC action re-zipped the tray
          {stage.barcode_clash ? " — and its new cell had already burned a clashing barcode." : "."}
        </Note>
      )}
      <div className={styles.details}>
        <div className={styles.row}>
          <span className={styles.label}>Sample</span>
          <span className={styles.sampleValue}>
            {stage.sample_id != null ? (
              // The Container ID links to the sample's own page; the ✎ opens the inline edit
              // popup (its loading parameters) - two distinct affordances, not one combined link.
              <Link to={`/samples/${stage.sample_id}`} state={backNav} className={styles.sampleLink}>
                {stage.sample_external_id ?? "—"}
              </Link>
            ) : (
              <b className={styles.value}>{stage.sample_external_id ?? "—"}</b>
            )}
            {sampleEditable && (
              <button
                type="button"
                className={`btn icon sm ${styles.sampleEditIconBtn}`}
                onClick={() => setEditingSample(true)}
                disabled={editingSample && sampleQuery.isLoading}
                title="Edit this sample's loading parameters"
                aria-label="Edit sample loading parameters"
              >
                <span aria-hidden="true">✎</span>
              </button>
            )}
          </span>
        </div>
        {editingSample && sampleQuery.isError && (
          <Note tone="bad" icon="!">
            {sampleQuery.error instanceof ApiError ? sampleQuery.error.message : "Failed to load the sample."}
          </Note>
        )}
        <div className={styles.row}>
          <span className={styles.label}>Well</span>
          <b className={styles.value}>{plateWellFromSlot(stage.slot_index, { full: true })}</b>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Run</span>
          <Link to={`/history/runs/${run.run_id}`} className={styles.runLink}>
            {runLabel(run)}
          </Link>
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
          {canEditRunTime ? (
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

      {runTimeMutation.isError && (
        <Note tone="bad" icon="!">
          {runTimeMutation.error instanceof ApiError ? runTimeMutation.error.message : "Failed to change run time."}
        </Note>
      )}

      {/* Estimated stage-times gantt for the whole run, this placement's row highlighted. */}
      <RunStageGantt runs={[run]} currentCellUseId={stage.cell_use_id} />

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

      {returnToBacklogMutation.isError && (
        <Note tone="bad" icon="!">
          {returnToBacklogMutation.error instanceof ApiError
            ? returnToBacklogMutation.error.message
            : "Failed to return to backlog."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={returnToBacklogMutation.isPending}>
          Close
        </Button>
        <Link to={`/cells/${stage.cell_id}`} className={`btn ghost ${styles.viewCellLink}`}>
          View cell
        </Link>
        {!isCancelled && (
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              onOpenQc(stage.cell_id, stage.cell_use_id);
            }}
          >
            Cell QC
          </Button>
        )}
        {isDiscardBlocked && (
          <Button
            variant="primary"
            onClick={() => returnToBacklogMutation.mutate()}
            disabled={returnToBacklogMutation.isPending}
          >
            {returnToBacklogMutation.isPending ? "Returning…" : "Return to backlog"}
          </Button>
        )}
      </ModalActions>
    </Modal>
  );
}

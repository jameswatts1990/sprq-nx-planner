import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { StageOut } from "@/types/schedule";
import type { CellChoice } from "@/types/schedulerGrid";
import { canMarkFailed } from "@/utils/cellUseQc";

import { useCompatibleCells } from "./useCompatibleCells";
import styles from "./SlotDetailPopover.module.css";

export interface SlotDetailPopoverProps {
  stage: StageOut;
  /** The owning run is confirmed/locked - hide the Remove/Change cell actions. */
  locked: boolean;
  instrumentSerial: string;
  onClose: () => void;
  onRemoved: () => void;
}

/** Which of the popover's alternate inline views is showing, in place of the normal
 * detail + footer. Mutually exclusive, so a single field rather than several booleans. */
type PopoverMode = "view" | "changeCell" | "markFailed" | "stop";

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample. When
 * the run is still "planned" (unlocked), offers "Remove from schedule" and "Change cell"
 * (swap this placement onto a different open cell, or a brand-new one, without touching
 * its day/slot - the orthogonal counterpart to dragging it to a new slot, which keeps the
 * cell fixed). Also offers the same QC quick actions as the Cell detail page - Mark
 * Failed (this use only) and Stop cell (the whole physical cell) - so a failure spotted
 * while browsing the grid doesn't require a detour to that page. Built on Modal; folds in
 * the old CellCard's cell-context display. */
export function SlotDetailPopover({ stage, locked, instrumentSerial, onClose, onRemoved }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PopoverMode>("view");
  const [selected, setSelected] = useState<string>("new"); // "new" | "<cellId>"
  const [failNotes, setFailNotes] = useState("");
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

  const stopMutation = useMutation({
    mutationFn: () => cellsApi.stop(stage.cell_id, { reason: stopReason || null }),
    onSuccess: (data) => {
      invalidateAfterQcAction();
      // If this exact placement's sample was cascaded back to the backlog (this use was
      // still "planned"), the slot itself is now gone - same as Remove. Otherwise (this
      // use already ran) the slot's history is untouched, only closing is needed.
      if (stage.sample_id !== null && data.bumped_sample_ids.includes(stage.sample_id)) onRemoved();
      else onClose();
    },
  });

  const cell = cellQuery.data;
  const currentUse = cell?.use_history.find((u) => u.id === stage.cell_use_id);
  const canFail = !!currentUse && canMarkFailed(currentUse);
  const stopDisabled = !cell || cell.status === "retired" || cell.status === "stopped";

  return (
    <Modal onClose={onClose} title={stage.cell_ref}>
      <div className={styles.row}>
        <span className={styles.label}>Sample</span>
        <b className={styles.value}>{stage.sample_external_id ?? "—"}</b>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Well</span>
        <b className={styles.value}>{stage.well}</b>
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

      {mode === "view" && (canFail || !stopDisabled) && (
        <div className={styles.qcRow}>
          <span className={styles.label}>QC</span>
          <div className={styles.qcButtons}>
            {canFail && (
              <Button size="sm" variant="ghost" onClick={() => setMode("markFailed")}>
                Mark Failed
              </Button>
            )}
            {!stopDisabled && (
              <Button size="sm" variant="ghost" onClick={() => setMode("stop")}>
                Stop cell
              </Button>
            )}
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

      <div className={styles.linkRow}>
        <Link to={`/cells/${stage.cell_id}`} className="btn primary sm">
          View cell →
        </Link>
      </div>

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

      {stopMutation.isError && (
        <Note tone="bad" icon="!">
          {stopMutation.error instanceof ApiError ? stopMutation.error.message : "Failed to stop cell."}
        </Note>
      )}

      <ModalActions>
        <Button
          variant="ghost"
          onClick={mode === "view" ? onClose : () => setMode("view")}
          disabled={removeMutation.isPending || changeCellMutation.isPending || markFailedMutation.isPending || stopMutation.isPending}
        >
          {mode === "view" ? "Close" : "Cancel"}
        </Button>
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
        {mode === "stop" && (
          <Button variant="primary" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
            {stopMutation.isPending ? "Stopping…" : "Stop cell"}
          </Button>
        )}
        {!locked && mode === "view" && (
          <>
            <Button variant="ghost" onClick={() => setMode("changeCell")}>
              Change cell
            </Button>
            <Button variant="primary" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
              {removeMutation.isPending ? "Removing…" : "Remove from schedule"}
            </Button>
          </>
        )}
      </ModalActions>
    </Modal>
  );
}

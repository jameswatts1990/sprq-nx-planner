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

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample. When
 * the run is still "planned" (unlocked), offers "Remove from schedule" and "Change cell"
 * (swap this placement onto a different open cell, or a brand-new one, without touching
 * its day/slot - the orthogonal counterpart to dragging it to a new slot, which keeps the
 * cell fixed). Built on Modal; folds in the old CellCard's cell-context display. */
export function SlotDetailPopover({ stage, locked, instrumentSerial, onClose, onRemoved }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();
  const [changingCell, setChangingCell] = useState(false);
  const [selected, setSelected] = useState<string>("new"); // "new" | "<cellId>"

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  const { cellsQuery: compatibleQuery, compatible } = useCompatibleCells({
    instrumentSerial,
    sampleBarcodes: stage.barcodes,
    excludeCellId: stage.cell_id,
    enabled: changingCell,
  });

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

  const cell = cellQuery.data;

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

      <div className={styles.linkRow}>
        <Link to={`/cells/${stage.cell_id}`} className={styles.cellLink}>
          View cell →
        </Link>
      </div>

      {changingCell && (
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

      <ModalActions>
        <Button
          variant="ghost"
          onClick={changingCell ? () => setChangingCell(false) : onClose}
          disabled={removeMutation.isPending || changeCellMutation.isPending}
        >
          {changingCell ? "Cancel" : "Close"}
        </Button>
        {!locked && changingCell && (
          <Button variant="primary" onClick={() => changeCellMutation.mutate()} disabled={changeCellMutation.isPending}>
            {changeCellMutation.isPending ? "Changing…" : "Confirm change"}
          </Button>
        )}
        {!locked && !changingCell && (
          <>
            <Button variant="ghost" onClick={() => setChangingCell(true)}>
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

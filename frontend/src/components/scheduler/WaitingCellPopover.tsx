import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

import styles from "./SlotDetailPopover.module.css";
import type { CellGhost } from "./waitingCells";

export interface WaitingCellPopoverProps {
  ghost: CellGhost;
  onClose: () => void;
}

/** Detail for a "ghost" empty slot: the waiting cell it represents, how close its 108h
 * window is to closing, and a way to write it off instead of reusing it. Modeled on
 * SlotDetailPopover's use of Modal/ModalActions. */
export function WaitingCellPopover({ ghost, onClose }: WaitingCellPopoverProps) {
  const queryClient = useQueryClient();
  const { cell, useNumber, isHardCutoff } = ghost;

  const retireMutation = useMutation({
    mutationFn: () => cellsApi.retire(cell.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      onClose();
    },
  });

  return (
    <Modal onClose={onClose} title={cell.code}>
      <div className={styles.row}>
        <span className={styles.label}>Next use</span>
        <b className={styles.value}>
          Use {useNumber} / {cell.max_uses}
        </b>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Instrument</span>
        <b className={styles.value}>{cell.current_instrument_serial}</b>
      </div>

      {isHardCutoff && (
        <Note tone="warn" icon="!">
          Last day this cell can start its next use within the 108-hour window.
        </Note>
      )}
      {cell.window_hours_elapsed !== null && <WindowMeter windowHours={cell.window_hours_elapsed} />}

      <div className={styles.linkRow}>
        <Link to={`/cells/${cell.id}`} className={styles.cellLink}>
          View cell →
        </Link>
      </div>

      <p className={styles.hint}>Drag a backlog sample onto this slot to load it here.</p>

      {retireMutation.isError && (
        <Note tone="bad" icon="!">
          {retireMutation.error instanceof ApiError ? retireMutation.error.message : "Failed to discard the cell."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={retireMutation.isPending}>
          Close
        </Button>
        <Button variant="primary" onClick={() => retireMutation.mutate()} disabled={retireMutation.isPending}>
          {retireMutation.isPending ? "Discarding…" : `Discard remaining use${cell.uses_remaining > 1 ? "s" : ""}`}
        </Button>
      </ModalActions>
    </Modal>
  );
}

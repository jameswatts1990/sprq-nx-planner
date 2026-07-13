import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { StageOut } from "@/types/schedule";

import styles from "./SlotDetailPopover.module.css";

export interface SlotDetailPopoverProps {
  stage: StageOut;
  /** The owning run is confirmed/locked - hide the Remove action. */
  locked: boolean;
  onClose: () => void;
  onRemoved: () => void;
}

/** Detail for one filled slot: cell code, the cell's burned barcodes, the sample. When
 * the run is still "planned" (unlocked), offers "Remove from schedule". Built on Modal;
 * folds in the old CellCard's cell-context display. */
export function SlotDetailPopover({ stage, locked, onClose, onRemoved }: SlotDetailPopoverProps) {
  const queryClient = useQueryClient();

  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
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

      {removeMutation.isError && (
        <Note tone="bad" icon="!">
          {removeMutation.error instanceof ApiError ? removeMutation.error.message : "Failed to remove placement."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={removeMutation.isPending}>
          Close
        </Button>
        {!locked && (
          <Button variant="primary" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
            {removeMutation.isPending ? "Removing…" : "Remove from schedule"}
          </Button>
        )}
      </ModalActions>
    </Modal>
  );
}

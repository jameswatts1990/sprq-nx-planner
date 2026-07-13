import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import type { CellChoice, PendingPlacement, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";

import { slotKey } from "./gridKeys";
import styles from "./CellChoicePicker.module.css";

export interface CellChoicePickerProps {
  pending: PendingPlacement;
  runDesign: RunDesignState;
  onClose: () => void;
  /** Called after a successful place (and after any remove-then-place move). */
  onPlaced: () => void;
  setPlacingSlotKey: (k: string | null) => void;
}

/** Returns true if this open cell can host the dragged sample: it has an unused use
 * left, and none of its already-burned barcodes clash with the sample's barcodes. */
function isCompatible(cell: CellOut, sampleBarcodes: string[]): boolean {
  return cell.uses_consumed < cell.max_uses && !cell.burned_barcodes.some((b) => sampleBarcodes.includes(b));
}

/**
 * Small picker shown between dropping a sample and committing the placement: "Use a new
 * cell" (default) or a compatible open/reusable cell. Confirm calls the place mutation
 * (a move first removes the source use). Placement persists immediately - success
 * invalidates the grid/backlog/cells queries so the sample moves out of the backlog.
 *
 * There's only a real decision to surface when a compatible reusable cell exists - if
 * none do, this places straight to a new cell (no modal), showing just the "placing…"
 * shimmer on the target slot while the compatibility check resolves. The modal only
 * appears when there's an actual choice, or when the auto-place attempt itself errors.
 */
export function CellChoicePicker({ pending, runDesign, onClose, onPlaced, setPlacingSlotKey }: CellChoicePickerProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>("new"); // "new" | "<cellId>"

  const cellsQuery = useQuery({
    queryKey: ["cells", { status: "open", instrument_serial: pending.instrument_serial, page_size: 200 }],
    queryFn: () => cellsApi.list({ status: "open", instrument_serial: pending.instrument_serial, page_size: 200 }),
  });

  const compatible = (cellsQuery.data?.items ?? []).filter((c) => isCompatible(c, pending.sample.barcodes));

  const targetKey = slotKey(pending.instrument_serial, pending.run_date, pending.slot_index);

  const mutation = useMutation({
    mutationFn: async (choice: CellChoice) => {
      // Move = remove the source use first, then place (no dedicated backend move).
      if (pending.moveFromCellUseId !== undefined) {
        await cellUsesApi.remove(pending.moveFromCellUseId);
      }
      return cellUsesApi.place({
        sample_id: pending.sample.id,
        instrument_serial: pending.instrument_serial,
        run_date: pending.run_date,
        slot_index: pending.slot_index,
        cell_choice: choice,
        run_time_hours: runDesign.run_time_hours,
        max_uses: runDesign.max_uses,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      setPlacingSlotKey(null);
      onPlaced();
    },
    onError: () => {
      setPlacingSlotKey(null);
    },
  });

  function confirm() {
    const choice: CellChoice =
      selected === "new" ? { mode: "new" } : { mode: "existing", cell_id: Number(selected) };
    setPlacingSlotKey(targetKey);
    mutation.mutate(choice);
  }

  // Nothing to decide (still checking, or checked and found no compatible cell) unless
  // the check itself failed or a real choice exists - in those cases fall through to the
  // modal so the user can see the error, or pick between "new" and a reusable cell.
  const showModal = cellsQuery.isError || compatible.length > 0 || mutation.isError;

  // Keep the target slot shimmering while we're silently resolving/auto-placing so the
  // grid still shows something is happening, even though no modal is shown.
  useEffect(() => {
    setPlacingSlotKey(showModal ? null : targetKey);
  }, [showModal, targetKey, setPlacingSlotKey]);

  const autoPlacedRef = useRef(false);
  useEffect(() => {
    if (cellsQuery.isLoading || cellsQuery.isError || compatible.length > 0) return;
    if (autoPlacedRef.current) return;
    autoPlacedRef.current = true;
    mutation.mutate({ mode: "new" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsQuery.isLoading, cellsQuery.isError, compatible.length]);

  if (!showModal) return null;

  const runDate = formatShortDateUTC(parseDateOnly(pending.run_date));

  return (
    <Modal onClose={onClose} title={`Place ${pending.sample.external_id || "sample"}`}>
      <p className={styles.target}>
        {pending.instrument_serial} · {runDate} · slot {pending.slot_index + 1}
      </p>
      <div className={styles.barcodes}>
        <span className={styles.barcodeLabel}>Sample barcodes</span>
        <BarcodeChips barcodes={pending.sample.barcodes} />
      </div>

      <fieldset className={styles.choices}>
        <legend className={styles.legend}>Cell</legend>
        <label className={styles.choice}>
          <input type="radio" name="cellChoice" value="new" checked={selected === "new"} onChange={() => setSelected("new")} />
          <span className={styles.choiceMain}>Use a new cell</span>
        </label>

        {cellsQuery.isError && (
          <Note tone="bad" icon="!">
            {cellsQuery.error instanceof ApiError ? cellsQuery.error.message : "Failed to load open cells."}
          </Note>
        )}
        {!cellsQuery.isLoading && !cellsQuery.isError && compatible.length === 0 && (
          <div className={styles.status}>
            No reusable cells in use on {pending.instrument_serial} - a new cell will be used.
          </div>
        )}

        {compatible.map((cell) => (
          <label key={cell.id} className={styles.choice}>
            <input
              type="radio"
              name="cellChoice"
              value={String(cell.id)}
              checked={selected === String(cell.id)}
              onChange={() => setSelected(String(cell.id))}
            />
            <span className={styles.choiceMain}>
              <span className={styles.code}>{cell.code}</span>
              <span className={styles.meta}>
                {cell.uses_consumed}/{cell.max_uses} uses
                {cell.current_instrument_serial ? ` · ${cell.current_instrument_serial}` : ""}
              </span>
            </span>
            <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
          </label>
        ))}
      </fieldset>

      {mutation.isError && (
        <Note tone="bad" icon="!">
          {mutation.error instanceof ApiError ? mutation.error.message : "Failed to place sample."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={mutation.isPending}>
          {mutation.isPending ? "Placing…" : "Place sample"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

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
import type { CycleOut } from "@/types/schedule";
import type { CellChoice, PendingPlacement, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";

import { slotKey, trayOfSlot } from "./gridKeys";
import styles from "./CellChoicePicker.module.css";

const DEFAULT_START_TIME = "12:00";

export interface CellChoicePickerProps {
  pending: PendingPlacement;
  runDesign: RunDesignState;
  /** The run already occupying (pending.instrument_serial, pending.run_date), if any.
   * Undefined means this placement/move would create a brand-new run - the only case
   * where a loading start time actually matters. */
  existingRun: CycleOut | undefined;
  onClose: () => void;
  /** Called after a successful place/move. */
  onPlaced: () => void;
  setPlacingSlotKey: (k: string | null) => void;
}

/** Returns true if this open cell can host the dragged sample: it has an unused use
 * left, and none of its already-burned barcodes clash with the sample's barcodes. */
function isCompatible(cell: CellOut, sampleBarcodes: string[]): boolean {
  return cell.uses_consumed < cell.max_uses && !cell.burned_barcodes.some((b) => sampleBarcodes.includes(b));
}

interface ConfirmVars {
  cellChoice: CellChoice;
  startHour?: number;
  startMinute?: number;
}

/**
 * Small picker shown between dropping a sample and committing the placement/move:
 * - A new placement (backlog sample dropped) offers "Use a new cell" (default) or a
 *   compatible open/reusable cell, same as before.
 * - A move (dragging an already-placed sample) has no cell decision at all - the atomic
 *   move endpoint keeps the same cell, just repositions it - so the cell-choice fieldset
 *   is skipped entirely.
 * Either way, if the drop would create a brand-new run (no existingRun for this
 * instrument+day yet), a loading start-time field is shown - that's the only thing that
 * ever forces the modal open when there'd otherwise be nothing to decide.
 */
export function CellChoicePicker({ pending, runDesign, existingRun, onClose, onPlaced, setPlacingSlotKey }: CellChoicePickerProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>("new"); // "new" | "<cellId>"
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const isMove = pending.moveFromCellUseId !== undefined;
  const isNewRun = existingRun === undefined;

  const cellsQuery = useQuery({
    queryKey: ["cells", { status: "open", instrument_serial: pending.instrument_serial, page_size: 200 }],
    queryFn: () => cellsApi.list({ status: "open", instrument_serial: pending.instrument_serial, page_size: 200 }),
    enabled: !isMove,
  });

  const compatible = isMove ? [] : (cellsQuery.data?.items ?? []).filter((c) => isCompatible(c, pending.sample.barcodes));

  const targetKey = slotKey(pending.instrument_serial, pending.run_date, pending.slot_index);

  const mutation = useMutation({
    mutationFn: async (vars: ConfirmVars) => {
      if (isMove) {
        return cellUsesApi.move(pending.moveFromCellUseId as number, {
          instrument_serial: pending.instrument_serial,
          run_date: pending.run_date,
          slot_index: pending.slot_index,
          run_time_hours: runDesign.run_time_hours,
          start_hour: vars.startHour,
          start_minute: vars.startMinute,
        });
      }
      return cellUsesApi.place({
        sample_id: pending.sample.id,
        instrument_serial: pending.instrument_serial,
        run_date: pending.run_date,
        slot_index: pending.slot_index,
        cell_choice: vars.cellChoice,
        run_time_hours: runDesign.run_time_hours,
        start_hour: vars.startHour,
        start_minute: vars.startMinute,
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

  function startTimeParts(): { startHour?: number; startMinute?: number } {
    if (!isNewRun) return {};
    const [h, m] = startTime.split(":").map(Number);
    return { startHour: h, startMinute: m };
  }

  function confirm() {
    const choice: CellChoice = selected === "new" ? { mode: "new" } : { mode: "existing", cell_id: Number(selected) };
    setPlacingSlotKey(targetKey);
    mutation.mutate({ cellChoice: choice, ...startTimeParts() });
  }

  // Nothing to decide (still checking, or checked and found no compatible cell, and this
  // isn't creating a new run) unless the check itself failed or a real choice exists - in
  // those cases fall through to the modal so the user can see the error, pick between
  // "new" and a reusable cell, or set the new run's start time.
  const showModal = isNewRun || (!isMove && (cellsQuery.isError || compatible.length > 0)) || mutation.isError;

  // Keep the target slot shimmering while we're silently resolving/auto-placing so the
  // grid still shows something is happening, even though no modal is shown.
  useEffect(() => {
    setPlacingSlotKey(showModal ? null : targetKey);
  }, [showModal, targetKey, setPlacingSlotKey]);

  const autoPlacedRef = useRef(false);
  useEffect(() => {
    if (isNewRun) return; // always needs the modal, for the start-time field
    if (!isMove && (cellsQuery.isLoading || cellsQuery.isError || compatible.length > 0)) return;
    if (autoPlacedRef.current) return;
    autoPlacedRef.current = true;
    mutation.mutate({ cellChoice: { mode: "new" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewRun, isMove, cellsQuery.isLoading, cellsQuery.isError, compatible.length]);

  if (!showModal) return null;

  const runDate = formatShortDateUTC(parseDateOnly(pending.run_date));
  const tray = trayOfSlot(pending.slot_index) + 1;
  const slotInTray = (pending.slot_index % 4) + 1;

  return (
    <Modal onClose={onClose} title={isMove ? "Move sample" : `Place ${pending.sample.external_id || "sample"}`}>
      <p className={styles.target}>
        {pending.instrument_serial} · {runDate} · Tray {tray}, slot {slotInTray}
      </p>
      <div className={styles.barcodes}>
        <span className={styles.barcodeLabel}>Sample barcodes</span>
        <BarcodeChips barcodes={pending.sample.barcodes} />
      </div>

      {isNewRun && (
        <div className={styles.choices}>
          <label className={styles.legend} htmlFor="loading-start-time">
            Loading start time
          </label>
          <input
            id="loading-start-time"
            className={styles.timeInput}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
      )}

      {!isMove && (
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
      )}

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
          {mutation.isPending ? "Placing…" : isMove ? "Move sample" : "Place sample"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

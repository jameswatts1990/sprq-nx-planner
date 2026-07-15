import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { CycleOut } from "@/types/schedule";
import type { CellChoice, PendingPlacement, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";

import { shouldAutoPlace, shouldShowCellChoiceModal } from "./cellChoiceGate";
import { slotKey, trayOfSlot } from "./gridKeys";
import { useCompatibleCells } from "./useCompatibleCells";
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
 * If the drop would create a brand-new run (no existingRun for this instrument+day yet),
 * a loading start-time field is shown - but only when there's also nowhere else to get a
 * start time. An unambiguous placement (a valid ghost preselect, or no reusable cell at
 * all) auto-confirms with a default start time even into a brand-new run; a move into a
 * brand-new run is the one case that always needs the modal, since moves have no cell
 * choice to resolve and thus no other way to collect a start time. See cellChoiceGate.ts.
 */
export function CellChoicePicker({ pending, runDesign, existingRun, onClose, onPlaced, setPlacingSlotKey }: CellChoicePickerProps) {
  const queryClient = useQueryClient();
  // Dropping directly onto a waiting-cell ghost already identifies exactly one cell -
  // default the radio to it so the (rare) case where the modal still has to show for some
  // other reason (e.g. a brand-new run's start time) doesn't reset the user's evident intent.
  const [selected, setSelected] = useState<string>(
    pending.preselectedCellId !== undefined ? String(pending.preselectedCellId) : "new",
  ); // "new" | "<cellId>"
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const isMove = pending.moveFromCellUseId !== undefined;
  const isNewRun = existingRun === undefined;

  const { cellsQuery, compatible } = useCompatibleCells({
    instrumentSerial: pending.instrument_serial,
    sampleBarcodes: pending.sample.barcodes,
    enabled: !isMove,
  });
  // Only trust the preselected ghost cell once it's confirmed still compatible (barcodes
  // could have changed since the ghost was computed) - otherwise fall back to the normal
  // choice-among-compatible-cells flow below.
  const preselectedValid =
    pending.preselectedCellId !== undefined && compatible.some((c) => c.id === pending.preselectedCellId);

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

  const gateInput = {
    isMove,
    isNewRun,
    cellsLoading: cellsQuery.isLoading,
    cellsError: cellsQuery.isError,
    compatibleCount: compatible.length,
    preselectedValid,
  };
  const showModal = shouldShowCellChoiceModal({ ...gateInput, mutationError: mutation.isError });

  // Keep the target slot shimmering while we're silently resolving/auto-placing so the
  // grid still shows something is happening, even though no modal is shown.
  useEffect(() => {
    setPlacingSlotKey(showModal ? null : targetKey);
  }, [showModal, targetKey, setPlacingSlotKey]);

  const autoPlacedRef = useRef(false);
  useEffect(() => {
    if (!shouldAutoPlace(gateInput)) return;
    if (autoPlacedRef.current) return;
    autoPlacedRef.current = true;
    const cellChoice: CellChoice = preselectedValid ? { mode: "existing", cell_id: pending.preselectedCellId as number } : { mode: "new" };
    // A brand-new run still needs an explicit start time even when auto-placing
    // silently - don't rely on the mutation/backend default matching DEFAULT_START_TIME.
    if (isNewRun) {
      const [startHour, startMinute] = DEFAULT_START_TIME.split(":").map(Number);
      mutation.mutate({ cellChoice, startHour, startMinute });
    } else {
      mutation.mutate({ cellChoice });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewRun, isMove, cellsQuery.isLoading, cellsQuery.isError, compatible.length, preselectedValid]);

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

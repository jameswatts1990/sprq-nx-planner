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
import { WELL_ORDER } from "./waitingCells";
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
 * - A move to the same well (a different day only) has no cell decision at all - the
 *   dragged cell just repositions there - so the cell-choice fieldset is skipped.
 * - A move to a *different* well where the dragged cell is already pinned elsewhere (by
 *   another of its own uses) can't take the cell there at all - cells stay in the same
 *   physical tray/well position for every reuse - so the sample instead needs a different
 *   cell, resolved via this same cell-choice fieldset exactly like a fresh placement (see
 *   wellConflict below).
 * If the drop would create a brand-new run (no existingRun for this instrument+day yet),
 * a loading start-time field is shown - but only when there's also nowhere else to get a
 * start time. An unambiguous placement (a valid ghost preselect, or no reusable cell at
 * all) auto-confirms with a default start time even into a brand-new run; a pure move
 * (no cell decision) into a brand-new run is the one case that always needs the modal,
 * since it has no cell choice to resolve and thus no other way to collect a start time.
 * See cellChoiceGate.ts.
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
    targetWell: WELL_ORDER[pending.slot_index],
    excludeCellId: isMove ? pending.moveFromCellId : undefined,
  });
  // The dragged slot's own cell, found in the same open-cells list used for `compatible` -
  // its current_well tells us whether it's pinned elsewhere, even by just this one use (a
  // cell's physical position is fixed the moment its tray opens, not just once it's been
  // reused - see wellConflict below). Not found at all (e.g. the cell has since gone
  // non-open) is treated as "no conflict detected" - the move endpoint's own authoritative
  // check still applies server-side regardless.
  const draggedCell = isMove ? cellsQuery.data?.find((c) => c.id === pending.moveFromCellId) : undefined;
  // The exact cell a direct ghost/resident drop targeted, looked up in the *raw* (unfiltered)
  // open-cells list rather than `compatible` - `compatible` already excludes a barcode-
  // clashing cell for other reasons too (capacity, wrong well), and we need to know
  // specifically whether a clash is why it's missing so it can be surfaced loudly instead
  // of silently substituting a new cell (see shouldAutoPlace/shouldShowCellChoiceModal).
  const preselectedCell =
    pending.preselectedCellId !== undefined ? cellsQuery.data?.find((c) => c.id === pending.preselectedCellId) : undefined;
  const clashingBarcodes = preselectedCell?.burned_barcodes.filter((b) => pending.sample.barcodes.includes(b)) ?? [];
  const preselectedBarcodeClash = preselectedCell !== undefined && clashingBarcodes.length > 0;
  // True whenever this move's destination well isn't where the dragged cell truly belongs -
  // either it's crossing instruments outright (a cell can never move between instruments,
  // regardless of well - two different instruments' grids reuse the same well-label set,
  // so a well-string match alone doesn't mean "same physical position"), or its own
  // established well differs from the drop target, or a *different* physical cell (the
  // destination's real ghost/resident, already computed for us as preselectedCellId)
  // already lives in that exact slot. Eager tray-of-4 population means the latter is
  // common even for a single-use cell, so this can't be gated on uses_consumed - the cell
  // can't go there either way, and the sample needs a different cell instead, resolved via
  // the same fieldset a fresh placement uses.
  const wellConflict =
    isMove &&
    (pending.fromInstrumentSerial !== pending.instrument_serial ||
      (draggedCell !== undefined &&
        draggedCell.current_well !== null &&
        draggedCell.current_well !== WELL_ORDER[pending.slot_index]) ||
      (pending.preselectedCellId !== undefined && pending.preselectedCellId !== pending.moveFromCellId));
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
          cell_choice: vars.cellChoice,
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
    wellConflict,
    isNewRun,
    cellsLoading: cellsQuery.isLoading,
    cellsError: cellsQuery.isError,
    compatibleCount: compatible.length,
    preselectedValid,
    preselectedBarcodeClash,
  };
  const showModal = shouldShowCellChoiceModal({ ...gateInput, mutationError: mutation.isError });

  // Keep the target slot shimmering while we're silently resolving/auto-placing so the
  // grid still shows something is happening, even though no modal is shown.
  useEffect(() => {
    setPlacingSlotKey(showModal ? null : targetKey);
  }, [showModal, targetKey, setPlacingSlotKey]);

  // The initial `selected` state defaults to the preselected cell before its barcodes have
  // even loaded (see useState above) - once loading confirms a clash, steer the radio off
  // it so confirming doesn't just resubmit the same rejected cell.
  useEffect(() => {
    if (preselectedBarcodeClash && selected === String(pending.preselectedCellId)) setSelected("new");
  }, [preselectedBarcodeClash, pending.preselectedCellId, selected]);

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
  }, [isNewRun, isMove, wellConflict, cellsQuery.isLoading, cellsQuery.isError, compatible.length, preselectedValid]);

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

      {preselectedBarcodeClash && preselectedCell && (
        <Note tone="bad" icon="!">
          <strong>Can&apos;t use cell {preselectedCell.code} here.</strong> It already has barcode
          {clashingBarcodes.length > 1 ? "s" : ""} {clashingBarcodes.join(", ")} burned in from an earlier use, which
          clashes with this sample&apos;s own barcode{pending.sample.barcodes.length > 1 ? "s" : ""} - the same
          barcode can never be read twice on one cell. Choose a different cell below, or use a new one.
        </Note>
      )}

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

      {(!isMove || wellConflict) && (
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

          {compatible.map((cell, i) => {
            // A divider whenever the tray changes - groups a physical SPRQ-Nx SMRT Cell
            // tray's cells together (see useCompatibleCells' tray-position sort) so the
            // other cells sharing this tray are visible at the point of choice, not just
            // the one currently open enough to reuse.
            const showTrayDivider = cell.tray_id !== null && cell.tray_id !== compatible[i - 1]?.tray_id;
            return (
              <div key={cell.id}>
                {showTrayDivider && (
                  <div className={styles.trayDivider}>
                    Cell tray - {compatible.filter((c) => c.tray_id === cell.tray_id).length} of {cell.tray_size} open
                  </div>
                )}
                <label className={styles.choice}>
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
                      {cell.tray_position ? ` · tray pos ${cell.tray_position}/${cell.tray_size}` : ""}
                      {cell.current_instrument_serial ? ` · ${cell.current_instrument_serial}` : ""}
                    </span>
                  </span>
                  <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
                </label>
              </div>
            );
          })}
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

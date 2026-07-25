import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { RunOut } from "@/types/schedule";
import type { CellChoice, PendingPlacement, RunDesignState } from "@/types/schedulerGrid";
import { DAY_START_HOUR, formatShortDateUTC, nextWeekdayIsoUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";

import { shouldAutoPlace, shouldShowCellChoiceModal } from "./cellChoiceGate";
import { plateOfSlot, slotKey } from "./gridKeys";
import { useCompatibleCells } from "./useCompatibleCells";
import { WELL_ORDER } from "./waitingCells";
import styles from "./CellChoicePicker.module.css";

/** The default loading start time, derived from the shared DAY_START_HOUR so it can't drift
 * from the reuse-window "day start" the ghosts use. */
const DEFAULT_START_TIME = `${String(DAY_START_HOUR).padStart(2, "0")}:00`;

/** slot_index 0-3 = Plate 1, 4-7 = Plate 2 (see gridKeys/SlotIndex). */
const PLATE_1_SLOT_COUNT = 4;

export interface CellChoicePickerProps {
  pending: PendingPlacement;
  runDesign: RunDesignState;
  /** The run already occupying (pending.instrument_serial, pending.load_date), if any.
   * Undefined means this placement/move would create a brand-new run - the only case
   * where a loading start time actually matters. */
  existingRun: RunOut | undefined;
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
  // A move whose preselected (ghost) cell IS the cell the dragged sample is already on -
  // e.g. dropping onto that same cell's own reuse ghost - can never be a real
  // clash: the cell's burned_barcodes aggregate includes this sample's own not-yet-moved
  // use, so it always "clashes" with itself here. No other use on the same cell could ever
  // already carry this exact barcode (placement/move already reject that for every use but
  // this one), so a same-cell move is always barcode-safe.
  const isMoveOntoOwnCell = isMove && pending.preselectedCellId === pending.moveFromCellId;
  const clashingBarcodes =
    !isMoveOntoOwnCell && preselectedCell ? preselectedCell.burned_barcodes.filter((b) => pending.sample.barcodes.includes(b)) : [];
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
  // choice-among-compatible-cells flow below. `compatible` deliberately excludes the
  // dragged cell itself (useCompatibleCells' excludeCellId) - it's the current placement,
  // not an alternative to offer - so a ghost-drop onto that same cell's own reuse
  // ghost (isMoveOntoOwnCell) has to be recognized as valid here directly,
  // rather than via that list, or it would wrongly fall back to "use a new cell".
  const preselectedValid =
    pending.preselectedCellId !== undefined &&
    (isMoveOntoOwnCell || compatible.some((c) => c.id === pending.preselectedCellId));

  // --- Intra-run Plate 2 reuse ----------------------------------------------------------
  // Dropping a backlog sample onto an empty Plate 2 slot (slot_index 4-7) that lines up with
  // a filled Plate 1 cell should offer reusing that same physical cell as the run's
  // sequential Use 2 (acquiring the next weekday) - the one-tray reuse run - rather than
  // silently opening a fresh parallel tray. The backend already models this: place_sample ->
  // _plate_target sees the cell is already loaded in this run and makes it Plate 2, next
  // weekday; this just surfaces it as the default choice. Position-pinned - a cell keeps its
  // A/B/C/D tray position for life - so slot 4 reuses Plate 1's A-slot cell, slot 5 the
  // B-slot cell, etc. (see placement_service._within_tray_pos). The cell is looked up in the
  // already-fetched open-cells list (it's excluded from `compatible` by the well filter,
  // since its own well is A01, not the Plate 2 slot's nominal A02).
  const alignedPlate1Cell =
    !isMove && plateOfSlot(pending.slot_index) === 1 && existingRun
      ? cellsQuery.data?.find(
          (c) =>
            c.id ===
            existingRun.plates
              .find((p) => p.plate_index === 1)
              ?.stages.find((s) => s.slot_index === pending.slot_index - PLATE_1_SLOT_COUNT)?.cell_id,
        )
      : undefined;
  // Only a genuinely reusable cell is offered: still open, capacity left, and no burned-
  // barcode clash (the same barcode can't be read twice on one cell, so a clash makes reuse
  // physically impossible and a fresh cell is then the correct outcome).
  const reuseCell =
    alignedPlate1Cell &&
    alignedPlate1Cell.status === "open" &&
    alignedPlate1Cell.uses_consumed < alignedPlate1Cell.max_uses &&
    !alignedPlate1Cell.burned_barcodes.some((b) => pending.sample.barcodes.includes(b))
      ? alignedPlate1Cell
      : undefined;
  // Feeds the choice gate as one more selectable cell, so the modal shows (rather than
  // silently auto-placing a new tray) whenever this reuse option exists.
  const compatibleCount = compatible.length + (reuseCell ? 1 : 0);

  const targetKey = slotKey(pending.instrument_serial, pending.load_date, pending.slot_index);

  const mutation = useMutation({
    mutationFn: async (vars: ConfirmVars) => {
      if (isMove) {
        return cellUsesApi.move(pending.moveFromCellUseId as number, {
          instrument_serial: pending.instrument_serial,
          load_date: pending.load_date,
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
        load_date: pending.load_date,
        slot_index: pending.slot_index,
        cell_choice: vars.cellChoice,
        run_time_hours: runDesign.run_time_hours,
        start_hour: vars.startHour,
        start_minute: vars.startMinute,
      });
    },
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
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
    compatibleCount,
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

  // Default the choice to the intra-run reuse cell (the common intent for a Plate 2 drop)
  // once the open-cells list has loaded, unless a ghost already preselected a specific cell.
  // Runs once, so it never fights a user who then deliberately picks "new".
  const reuseDefaultedRef = useRef(false);
  useEffect(() => {
    if (reuseDefaultedRef.current) return;
    if (reuseCell && pending.preselectedCellId === undefined) {
      reuseDefaultedRef.current = true;
      setSelected(String(reuseCell.id));
    }
  }, [reuseCell, pending.preselectedCellId]);

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
  }, [isNewRun, isMove, wellConflict, cellsQuery.isLoading, cellsQuery.isError, compatibleCount, preselectedValid]);

  if (!showModal) return null;

  const loadDate = formatShortDateUTC(parseDateOnly(pending.load_date));
  const plate = plateOfSlot(pending.slot_index) + 1;
  const well = WELL_ORDER[pending.slot_index];
  const loadDateLabel = `${shortWeekdayUTC(parseDateOnly(pending.load_date))} ${loadDate}`;
  const reuseAcquireIso = nextWeekdayIsoUTC(pending.load_date);
  const reuseAcquireLabel = `${shortWeekdayUTC(parseDateOnly(reuseAcquireIso))} ${formatShortDateUTC(parseDateOnly(reuseAcquireIso))}`;

  return (
    <Modal onClose={onClose} title={isMove ? "Move sample" : `Place ${pending.sample.external_id || "sample"}`}>
      <p className={styles.target}>
        {pending.instrument_serial} · {loadDate} · Plate {plate}, well {well}
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

          {reuseCell && (
            <label className={styles.choice}>
              <input
                type="radio"
                name="cellChoice"
                value={String(reuseCell.id)}
                checked={selected === String(reuseCell.id)}
                onChange={() => setSelected(String(reuseCell.id))}
              />
              <span className={styles.choiceMain}>
                <span className={styles.code}>{reuseCell.code}</span>
                <span className={styles.meta}>
                  Reuse Plate 1 cell · Use {reuseCell.uses_consumed + 1} · acquires {reuseAcquireLabel}
                </span>
              </span>
              <BarcodeChips barcodes={reuseCell.burned_barcodes} variant="u2" />
            </label>
          )}

          <label className={styles.choice}>
            <input type="radio" name="cellChoice" value="new" checked={selected === "new"} onChange={() => setSelected("new")} />
            <span className={styles.choiceMain}>
              <span>Use a new cell</span>
              {reuseCell && <span className={styles.meta}>fresh tray · Use 1 · acquires {loadDateLabel}</span>}
            </span>
          </label>

          {cellsQuery.isError && (
            <Note tone="bad" icon="!">
              {cellsQuery.error instanceof ApiError ? cellsQuery.error.message : "Failed to load open cells."}
            </Note>
          )}
          {!cellsQuery.isLoading && !cellsQuery.isError && compatible.length === 0 && !reuseCell && (
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

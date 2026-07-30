import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { RunOut, StageOut } from "@/types/schedule";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { plateWellFromSlot, plateWellFromWell } from "@/utils/plateWell";

import { CellChoicePicker } from "./CellChoicePicker";
import styles from "./SlotDetailPopover.module.css";

export interface CellInfoPopoverProps {
  /** The placed stage whose physical cell this describes (the card's "ticket stub" click). */
  stage: StageOut;
  /** The owning run - gives the instrument/load-day context the reuse override needs. */
  run: RunOut;
  onClose: () => void;
  /** Open the shared Cell QC modal for this physical cell (anchored on this use). */
  onOpenQc: (cellId: number, cellUseId: number) => void;
}

/**
 * The physical-cell info popover behind a card's cell "ticket stub". Focused on the CELL
 * itself (its uses, 108h window, tray position, burned barcodes) - complementary to
 * SlotDetailPopover, which the card body opens and which is about this one placement.
 *
 * When the placement is a *reuse* (Plate 2 rerunning an earlier plate's cell, Use >= 2), it
 * also offers the one physically-clean override to the engine's reuse-before-new choice:
 * "Use a new cell instead", which re-points this well to a fresh parallel tray (running the
 * same day) rather than reusing. That's an atomic move (never a bounce through the backlog).
 * There's deliberately no in-place "swap to a different existing cell" - a cell IS the
 * physical thing in its well, so it can't be swapped without the tray leaving (see
 * cell_service.open_new_tray's note on the removed change_cell); to reuse a *different* cell,
 * drag the sample onto that cell's own slot. And the engine already prefers reuse, so a
 * non-reuse placement means no eligible reuse existed to offer here anyway.
 */
export function CellInfoPopover({ stage, run, onClose, onOpenQc }: CellInfoPopoverProps) {
  const queryClient = useQueryClient();
  const cellQuery = useQuery({
    queryKey: ["cell", stage.cell_id],
    queryFn: () => cellsApi.get(stage.cell_id),
    enabled: Number.isFinite(stage.cell_id),
  });

  const plate = run.plates.find((p) => p.stages.some((s) => s.cell_use_id === stage.cell_use_id));
  const isReuse = plate?.is_reuse ?? false;
  const canOverride = isReuse && run.status === "planned" && stage.cell_use_status === "planned" && stage.sample_id !== null;
  // Broader than canOverride - available for any planned placement, reuse or not, not just
  // the auto-derived reuse case "Use a new cell instead" already covers.
  const canChooseCell = run.status === "planned" && stage.cell_use_status === "planned" && stage.sample_id !== null;
  const [pickerOpen, setPickerOpen] = useState(false);

  // "Use a new cell instead": drop the reuse and re-place the sample fresh at the same slot.
  // Deliberately a remove + place, NOT a move: a move would re-point the well into the
  // *existing* Plate 2 cycle, keeping that cycle's later (reuse) acquire_date and is_reuse
  // flag - so the fresh cell would wrongly still read as a next-day reuse. Removing the sole
  // reuse first deletes that Plate 2 cycle, so the fresh placement builds a correct new Plate 2
  // acquiring the load day (a same-day parallel tray). The sample is planned (not yet loaded),
  // so this re-plan is safe; place into the already-existing run is never lock-gated.
  // Not a single transaction: the remove and the re-place are two calls. If the re-place
  // fails after the remove succeeded, the sample has genuinely left the schedule (it's back
  // in the backlog) - so surface that plainly rather than implying nothing changed, and
  // invalidate either way so the grid reflects reality.
  const [removed, setRemoved] = useState(false);
  const useNewCell = useMutation({
    mutationFn: async () => {
      await cellUsesApi.remove(stage.cell_use_id);
      setRemoved(true);
      return cellUsesApi.place({
        sample_id: stage.sample_id as number,
        instrument_serial: run.instrument_serial,
        load_date: run.load_date,
        slot_index: stage.slot_index,
        run_time_hours: stage.run_time_hours,
        cell_choice: { mode: "new" },
      });
    },
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      onClose();
    },
    onError: () => {
      // Refresh regardless: if the remove landed but the place didn't, the grid must stop
      // showing the old reuse placement (the sample is now in the backlog).
      invalidateScheduleRelated(queryClient);
    },
  });

  // "Choose a specific cell": the manual override for when the auto-derived choice isn't
  // what's wanted - same remove-then-place shape as useNewCell above, just with an explicit
  // cell_id instead of {mode:"new"}. The backend still enforces that a plate can never end
  // up split across two physical trays (see placement_service._established_tray_id), so this
  // can guide a correct fix (e.g. forcing Plate 2 onto Plate 1's exact cells) but can't be
  // used to recreate that bug - an invalid pick surfaces as a clear error below, same as any
  // other placement rejection.
  const chooseCell = useMutation({
    mutationFn: async (cellId: number) => {
      await cellUsesApi.remove(stage.cell_use_id);
      setRemoved(true);
      return cellUsesApi.place({
        sample_id: stage.sample_id as number,
        instrument_serial: run.instrument_serial,
        load_date: run.load_date,
        slot_index: stage.slot_index,
        run_time_hours: stage.run_time_hours,
        cell_choice: { mode: "existing", cell_id: cellId },
      });
    },
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setPickerOpen(false);
      onClose();
    },
    onError: () => {
      invalidateScheduleRelated(queryClient);
    },
  });

  const cell = cellQuery.data;

  return (
    <Modal onClose={onClose} title={stage.cell_ref}>
      <div className={styles.details}>
        <div className={styles.row}>
          <span className={styles.label}>Status</span>
          <span className={styles.value}>
            {cell ? <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge> : "…"}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>This load</span>
          <b className={styles.value}>
            Use {stage.use_number} of {cell?.max_uses ?? 3}
          </b>
        </div>
        {cell && (
          <>
            <div className={styles.row}>
              <span className={styles.label}>Uses so far</span>
              <b className={styles.value}>
                {cell.uses_consumed} of {cell.max_uses} ({cell.uses_remaining} left)
              </b>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Location</span>
              <b className={styles.value}>
                {cell.current_instrument_serial ?? "—"} ·{" "}
                {cell.current_well
                  ? plateWellFromWell(cell.current_well, { qualified: true })
                  : plateWellFromSlot(stage.slot_index, { qualified: true })}
              </b>
            </div>
            {cell.tray_id !== null && (
              <div className={styles.row}>
                <span className={styles.label}>Tray</span>
                <b className={styles.value}>
                  <Link to={`/cells?tray=${cell.tray_id}`} className="link">
                    Tray {cell.tray_id}
                    {cell.tray_position !== null ? ` · cell ${cell.tray_position}/${cell.tray_size}` : ""}
                  </Link>
                </b>
              </div>
            )}
          </>
        )}
      </div>

      {cellQuery.isError && (
        <Note tone="bad" icon="!">
          {cellQuery.error instanceof ApiError ? cellQuery.error.message : "Failed to load cell details."}
        </Note>
      )}

      {cell && cell.window_hours_elapsed !== null && <WindowMeter windowHours={cell.window_hours_elapsed} />}

      {cell && cell.burned_barcodes.length > 0 && (
        <div className={styles.details}>
          <div className={styles.row}>
            <span className={styles.label}>Burned barcodes</span>
            <BarcodeChips barcodes={cell.burned_barcodes} variant="u2" />
          </div>
        </div>
      )}

      {isReuse && (
        <Note tone="info" icon="i">
          This well <b>reuses</b> an earlier plate&apos;s cell (its Use {stage.use_number}), acquiring the day after
          loading.{" "}
          {canOverride ? "You can load a fresh cell here instead — a separate tray that runs the same day." : ""}
        </Note>
      )}

      {useNewCell.isError && (
        <Note tone="bad" icon="!">
          {removed ? (
            <>
              This reuse was dropped, but placing a fresh cell failed
              {useNewCell.error instanceof ApiError ? ` (${useNewCell.error.message})` : ""} — the sample is now back in
              the Backlog. Re-place it from there.
            </>
          ) : useNewCell.error instanceof ApiError ? (
            useNewCell.error.message
          ) : (
            "Couldn't switch to a new cell."
          )}
        </Note>
      )}

      {chooseCell.isError && (
        <Note tone="bad" icon="!">
          {removed ? (
            <>
              The old placement was dropped, but placing onto that cell failed
              {chooseCell.error instanceof ApiError ? ` (${chooseCell.error.message})` : ""} — the sample is now back
              in the Backlog. Re-place it from there.
            </>
          ) : chooseCell.error instanceof ApiError ? (
            chooseCell.error.message
          ) : (
            "Couldn't switch to that cell."
          )}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={useNewCell.isPending || chooseCell.isPending}>
          Close
        </Button>
        <Link to={`/cells/${stage.cell_id}`} className={`btn ghost ${styles.viewCellLink}`}>
          View full cell
        </Link>
        <Button
          variant="danger"
          onClick={() => {
            onClose();
            onOpenQc(stage.cell_id, stage.cell_use_id);
          }}
          disabled={useNewCell.isPending || chooseCell.isPending}
        >
          QC…
        </Button>
        {canChooseCell && (
          <Button variant="ghost" onClick={() => setPickerOpen(true)} disabled={useNewCell.isPending || chooseCell.isPending}>
            Choose a specific cell…
          </Button>
        )}
        {canOverride && (
          <Button variant="primary" onClick={() => useNewCell.mutate()} disabled={useNewCell.isPending}>
            {useNewCell.isPending ? "Switching…" : "Use a new cell instead"}
          </Button>
        )}
      </ModalActions>

      {pickerOpen && (
        <CellChoicePicker
          instrumentSerial={run.instrument_serial}
          suggestedTrayId={cell?.tray_id ?? null}
          pending={chooseCell.isPending}
          onSelect={(cellId) => chooseCell.mutate(cellId)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Modal>
  );
}

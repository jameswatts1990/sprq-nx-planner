import { useMutation, useQueryClient } from "@tanstack/react-query";
import { memo, useState, type KeyboardEvent, type MouseEvent } from "react";

import { cellsApi } from "@/api/cells";
import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { SlotIndex, RunOut, StageOut } from "@/types/schedule";
import { formatShortDateTimeUTC, formatShortDateUTC, formatTimeUTC, parseDateOnly, shortWeekdayUTC } from "@/utils/calendarDates";
import { runLabel } from "@/utils/runLabel";

import { PLATE_INDICES, slotKey } from "./gridKeys";
import { allStages, padStages, type Continuation } from "./groupCyclesByInstrumentAndDay";
import { SchedulerSlot } from "./SchedulerSlot";
import styles from "./SchedulerDayCell.module.css";
import type { SlotSelection } from "./useSlotSelection";
import { pinGhostsToSlots, WELL_ORDER, type CellGhost, type CellExpiryWarning } from "./waitingCells";

export interface SchedulerDayCellProps {
  instrumentSerial: string;
  loadDate: string;
  rowIndex: number;
  colIndex: number;
  weekend: boolean;
  run: RunOut | undefined;
  /** An earlier run on this instrument still occupying this day (its Plate 2 acquires here,
   * or its lock spans it), when this day has no run of its own - purely informational, never
   * affects `selectable`. */
  continuation: Continuation | undefined;
  /** No run yet and not a weekend - eligible for select + auto-fill. */
  selectable: boolean;
  /** Currently selected (and selectable) - via shift-click rectangle or ctrl/cmd-click toggle. */
  selected: boolean;
  placingSlotKey: string | null;
  onSelect: (r: number, c: number, shift: boolean, ctrl: boolean) => void;
  onOpenDetail: (stage: StageOut, run: RunOut) => void;
  /** Opens the in-grid cell-info popover for a placement's physical cell (the card's
   * right-edge "ticket stub" click). Carries the owning run (like onOpenDetail) so the
   * popover has the instrument/load-day context its "use a different cell" override needs. */
  onOpenCell?: (stage: StageOut, run: RunOut) => void;
  slotSelection: SlotSelection;
  /** Ctrl/cmd+shift-click on a filled slot - extends slotSelection to a rectangle
   * between the last-toggled slot and this one (see SchedulePage.onExtendSlotSelect). */
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  /** Ctrl/cmd-mousedown on a filled slot - starts a click-and-drag rectangle selection
   * (see SchedulePage.onDragSelectStart). */
  onDragSelectStart: (stage: StageOut, coord: { r: number; c: number }) => void;
  /** Waiting, reusable cells eligible to load on this instrument+day (see waitingCells.ts).
   * Ignored while the day's run is locked, since it can no longer accept placements. */
  waitingCells: CellGhost[];
  /** Wells on this instrument permanently blocked by a stopped cell on this day (see
   * waitingCells.computeBlockedWellsByInstrumentAndDay) - rendered as a non-droppable
   * "blocked" placeholder instead of the plain "+" so this well never reads as an ordinary
   * free slot. */
  blockedWells: Set<string>;
  /** Physical cells resident here whose 108h reuse window closes on this day with uses still
   * unspent - this day is the last chance to reuse them before that capacity is lost (see
   * waitingCells.computeCellExpiryWarnings). Surfaced next to Confirm loaded. Per-cell: a tray
   * as a whole doesn't expire, only its individual used cells do. */
  expiryWarnings: CellExpiryWarning[];
}

/**
 * One (instrument, load-day) grid cell. Weekends render closed/non-interactive. Otherwise a
 * run's two plate blocks (Plate 1 = slots 0-3, Plate 2 = slots 4-7), always both shown in
 * full, with a header carrying the single per-run Confirm-loaded / Unlock control once the
 * run exists. A day with no run of its own but occupied by an earlier run's continuation
 * (a reuse Plate 2 acquiring here, or a lock carry-over) renders read-only with a lightweight
 * marker. Empty non-weekend cells participate in spreadsheet-style range selection for
 * auto-fill.
 */
export const SchedulerDayCell = memo(function SchedulerDayCell(props: SchedulerDayCellProps) {
  const {
    instrumentSerial,
    loadDate,
    rowIndex,
    colIndex,
    weekend,
    run,
    continuation,
    selectable,
    selected,
    placingSlotKey,
    onSelect,
    slotSelection,
    onExtendSelect,
    onDragSelectStart,
    waitingCells,
    blockedWells,
    expiryWarnings,
  } = props;
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (req: { status: "running" | "planned"; run_name?: string }) => {
      if (!run) throw new Error("No run to update.");
      return cyclesApi.updateStatus(run.run_id, req);
    },
    onSuccess: () => {
      // Confirming a run "running" anchors each cell's 108h clock (first_use_started_at),
      // and Unlock recomputes it - both change the ["cells"]-fed waiting/terminal ghost
      // markers (deadline dates, tray founding, window shading), not just the run itself.
      // So invalidate the whole schedule-related set, not only ["cycles"], the same way the
      // rotate mutation below does.
      invalidateScheduleRelated(queryClient);
      setConfirmingLoad(false);
    },
  });

  const [confirmingLoad, setConfirmingLoad] = useState(false);
  const [runName, setRunName] = useState("");

  const [rotateTrayId, setRotateTrayId] = useState<number | null>(null);
  const rotateMutation = useMutation({
    mutationFn: (trayId: number) => cellsApi.rotateTray({ tray_id: trayId, from_date: loadDate }),
    onSuccess: () => {
      // The old tray's cells just went terminal and this day's (plus every later) use moved
      // onto a freshly-minted tray - without this, the grid's real stages, waiting/terminal/
      // vacated-tray ghosts (waitingCells.ts, fed by SchedulePage's ["cells", ...] queries)
      // and the Backlog page would keep reading pre-rotate data until some unrelated
      // mutation happened to invalidate them.
      invalidateScheduleRelated(queryClient);
      setRotateTrayId(null);
    },
  });

  if (weekend) {
    return (
      <td
        className={`${styles.cell} ${styles.weekend}`}
        aria-hidden="true"
        data-row={rowIndex}
        data-col={colIndex}
      />
    );
  }

  // A day with no run of its own is still effectively locked if an earlier run's continuation
  // occupies it (continuation) - the instrument is running that run's later plate, or is still
  // locked - so every slot below must render as a read-only marker (or non-droppable ghost),
  // same as a genuinely locked run, rather than falling through to a live, droppable "+" just
  // because this exact day has no run row of its own yet (see isCellOpen, which gates
  // selectability the same way).
  const locked = (run !== undefined && run.status !== "planned") || (run === undefined && continuation !== undefined);
  const filledCount = run ? allStages(run).length : 0;
  // lock_until's calendar date > this run's own load_date - the run's lock bleeds into
  // (or past) subsequent days, worth calling out right where it started.
  const lockExtendsPastToday = run !== undefined && run.lock_until.slice(0, 10) > loadDate;
  const slots = padStages(run);

  // The earlier run's plate that acquires exactly on this continuation day (a reuse Plate 2
  // the instrument runs itself), if that's why the day is occupied.
  const continuationPlate =
    run === undefined && continuation?.acquiresToday
      ? continuation.run.plates.find((p) => p.acquire_date === loadDate)
      : undefined;

  // A locked day can no longer accept placements, so every ghost renders purely
  // informationally there (SchedulerSlot never wraps a locked slot in a droppable, even
  // when a ghost is passed through) rather than being dropped from the grid entirely -
  // the expiry/"not yet used"/"scheduled" information a ghost carries is still accurate
  // and useful on a locked day (see "Never-yet-used tray cells" in the Schedule help
  // section), it's only the placement *offer* that a locked day can't honour.
  // Each waiting cell is pinned to the exact slot matching its own last-used well
  // (WELL_ORDER) - cells stay in the same physical tray/well position for every reuse, never
  // just "the next open slot" - so a ghost only shows if that specific slot is free. When two
  // different waiting cells both last sat in the same well letter and are eligible the same
  // day, a cell whose physical tray is actually present today beats one from a tray not yet
  // founded as of this day (see pinGhostsToSlots); otherwise the first in waitingCells order
  // wins and the other simply has no ghost that day.
  const ghostBySlot = pinGhostsToSlots(waitingCells, slots);

  // A well left behind by a stopped cell (see waitingCells.computeBlockedWellsByInstrumentAndDay)
  // never gets a ghost (stop_cell excludes it from reuse) and never gets a stage again, so
  // without this it would silently fall through to the plain "+" placeholder below and
  // read as an ordinary free slot - even though the physical well is permanently dead.
  const blockedSlotSet = new Set<SlotIndex>();
  WELL_ORDER.forEach((well, i) => {
    const slot = i as SlotIndex;
    if (slots[slot] === null && !ghostBySlot.has(slot) && blockedWells.has(well)) blockedSlotSet.add(slot);
  });

  function onCellClick(e: MouseEvent<HTMLTableCellElement>) {
    if (selectable) onSelect(rowIndex, colIndex, e.shiftKey, e.ctrlKey || e.metaKey);
  }
  function onCellKeyDown(e: KeyboardEvent<HTMLTableCellElement>) {
    if (selectable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onSelect(rowIndex, colIndex, e.shiftKey, e.ctrlKey || e.metaKey);
    }
  }

  const cellClasses = [styles.cell];
  if (selectable) cellClasses.push(styles.selectable);
  if (selected) cellClasses.push(styles.selected);
  if (!run) cellClasses.push(styles.emptyCell);

  return (
    <td
      className={cellClasses.join(" ")}
      onClick={selectable ? onCellClick : undefined}
      onKeyDown={selectable ? onCellKeyDown : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? selected : undefined}
      data-row={rowIndex}
      data-col={colIndex}
    >
      {/* Always rendered (even with nothing to show) so every cell's plate/placeholder
          area starts at the same vertical offset within the row, whether or not this
          particular cell has a badge above it. */}
      <div className={styles.head}>
        {run && (
          <>
            {/* The run's single identity, surfaced once at the run level (not per plate) so
                a two-plate reuse run reads as one run. Its name once set, else "#<run id>". */}
            <span className={styles.runIdTag} title={`Run ${runLabel(run)}`}>
              {runLabel(run)}
            </span>
            {(() => {
              // The run's load/start time, from Plate 1's planned start - since there are no
              // pre-loaded runs, this is when it loads AND starts sequencing.
              const plate1 = run.plates.find((p) => p.plate_index === 1);
              return plate1 ? (
                <span
                  className={styles.loadTimeTag}
                  title={`Loads and starts sequencing at ${formatTimeUTC(plate1.planned_start_at)}`}
                >
                  ⏱ {formatTimeUTC(plate1.planned_start_at)}
                </span>
              ) : null;
            })()}
            {locked ? (
              <>
                <span
                  className={styles.lockTag}
                  title={run.run_name ? `Run name: ${run.run_name}` : undefined}
                >
                  {run.status === "running" ? "LOADED" : run.status.toUpperCase()}
                  {lockExtendsPastToday && ` · locked until ${formatShortDateTimeUTC(run.lock_until)}`}
                </span>
                {run.status === "running" && (
                  <button
                    type="button"
                    className={styles.ctrl}
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ status: "planned" })}
                  >
                    {statusMutation.isPending ? "…" : "Unlock"}
                  </button>
                )}
              </>
            ) : (
              filledCount >= 1 && (
                <button
                  type="button"
                  className={`${styles.ctrl} ${styles.confirm}`}
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    setRunName(run.run_name ?? "");
                    setConfirmingLoad(true);
                  }}
                >
                  {statusMutation.isPending ? "Confirming…" : "Confirm loaded"}
                </button>
              )
            )}
          </>
        )}

        {!run && continuation && (
          continuationPlate ? (
            <span
              className={styles.carryLockTag}
              title="No action here — the instrument runs this plate itself once Plate 1's movie finishes and the cells are washed (a reuse run's Plate 2 — the next working day for a normal-length movie, later for a very long one). Manage it from its own run on its load day."
            >
              Plate {continuationPlate.plate_index} runs here
            </span>
          ) : (
            <span className={styles.carryLockTag}>Locked until {formatShortDateTimeUTC(continuation.run.lock_until)}</span>
          )
        )}
      </div>

      {/* Cells physically resident here whose 108h reuse window closes on this day with uses
          still unspent - the last chance to reuse them before that capacity expires. Per-cell,
          driven only by each cell's own 108h clock: a tray doesn't expire as a unit, and a
          never-used sibling (no clock) is never flagged. Shown right under the Confirm-loaded
          control so the waste is obvious before the run is locked in. */}
      {expiryWarnings.map((w) => {
        const uses = `${w.usesRemaining} unused use${w.usesRemaining === 1 ? "" : "s"}`;
        const by = formatShortDateUTC(parseDateOnly(w.cutoffDate));
        return (
          <div
            key={w.cellId}
            className={styles.disposalWarn}
            title={`Cell ${w.cellCode}${w.well ? ` (well ${w.well})` : ""} has ${uses} left, but its 108h reuse window closes after ${by}. Reuse it by then, or that capacity is lost.`}
          >
            ⚠ {w.cellCode}
            {w.well ? ` · ${w.well}` : ""} — {uses} expiring after {by}
          </div>
        );
      })}

      {statusMutation.isError && (
        <div className={styles.err}>
          {statusMutation.error instanceof ApiError ? statusMutation.error.message : "Status update failed."}
        </div>
      )}

      <div className={styles.slots}>
        {PLATE_INDICES.map((indices, plateIdx) => {
          const plate = run?.plates.find((p) => p.plate_index === plateIdx + 1);
          // Any filled slot in this plate carries the physical tray's id (see StageOut.tray_id) -
          // used to target every sibling cell, not just the ones with a filled slot this cycle.
          const trayId = indices.map((i) => slots[i]).find((s) => s?.tray_id != null)?.tray_id ?? null;
          return (
            <div key={plateIdx} className={styles.tray}>
              <div className={styles.trayHeader}>
                <div className={styles.plateLabelWrap}>
                  <span className={styles.trayLabel}>{plateIdx === 0 ? "Plate 1" : "Plate 2"}</span>
                  {plate?.is_reuse && (
                    <span
                      className={styles.reuseTag}
                      title="Reuse — this plate reruns Plate 1's cells on a later day (Use 2+); the instrument runs it itself, in one load session."
                    >
                      reuse
                    </span>
                  )}
                  {plate && plate.acquire_date !== loadDate && (
                    <span
                      className={styles.acquireTag}
                      title={
                        plate.is_reuse
                          ? `Runs after Plate 1's movie finishes and the cells are washed — starts ${formatShortDateTimeUTC(plate.planned_start_at)} (the reuse day reflects the movie length, so a longer movie pushes it later).`
                          : `Plate ${plate.plate_index} acquires on ${shortWeekdayUTC(parseDateOnly(plate.acquire_date))} ${formatShortDateUTC(parseDateOnly(plate.acquire_date))}`
                      }
                    >
                      → {shortWeekdayUTC(parseDateOnly(plate.acquire_date))} {formatShortDateUTC(parseDateOnly(plate.acquire_date))}
                    </span>
                  )}
                </div>
                {trayId != null && !locked && (
                  <button
                    type="button"
                    className={styles.rotateBtn}
                    title="Rotate tray — load a fresh tray from this day (moves this day's samples and any later uses onto new cells)"
                    aria-label="Rotate tray — load a fresh tray from this day"
                    onClick={() => setRotateTrayId(trayId)}
                  >
                    ↻
                  </button>
                )}
              </div>
              {indices.map((i) => (
                <SchedulerSlot
                  key={i}
                  stage={slots[i]}
                  slotIndex={i}
                  instrumentSerial={instrumentSerial}
                  loadDate={loadDate}
                  locked={locked}
                  placing={placingSlotKey === slotKey(instrumentSerial, loadDate, i)}
                  selected={
                    !locked &&
                    slots[i] !== null &&
                    slots[i]!.cell_use_status !== "cancelled" &&
                    slotSelection.isSelected(slots[i]!.cell_use_id)
                  }
                  onOpenDetail={(stage) => props.onOpenDetail(stage, run as RunOut)}
                  onOpenCell={props.onOpenCell ? (stage) => props.onOpenCell!(stage, run as RunOut) : undefined}
                  onToggleSelect={(stage) => slotSelection.toggle(stage, { r: rowIndex, c: colIndex })}
                  onExtendSelect={(stage) => onExtendSelect(stage, { r: rowIndex, c: colIndex })}
                  onDragSelectStart={(stage) => onDragSelectStart(stage, { r: rowIndex, c: colIndex })}
                  ghost={ghostBySlot.get(i)}
                  blocked={blockedSlotSet.has(i)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {confirmingLoad && (
        <ConfirmModal
          title="Confirm cells loaded?"
          confirmLabel="Confirm loaded"
          pendingLabel="Confirming…"
          pending={statusMutation.isPending}
          error={
            statusMutation.isError
              ? statusMutation.error instanceof ApiError
                ? statusMutation.error.message
                : "Status update failed."
              : null
          }
          input={{
            label: "Run name (optional)",
            value: runName,
            onChange: setRunName,
            placeholder: "e.g. TRACTION-RUN-1234",
          }}
          onCancel={() => setConfirmingLoad(false)}
          onConfirm={() => statusMutation.mutate({ status: "running", run_name: runName })}
        >
          <p>
            This locks the whole run — both plates — so it can no longer be edited by accident. Give it a name (e.g.
            your lab&apos;s TRACTION run id) if you&apos;d like it shown instead of the run number everywhere this run
            appears.
          </p>
        </ConfirmModal>
      )}

      {rotateTrayId != null && (
        <ConfirmModal
          title="Rotate this tray?"
          confirmLabel="Rotate tray"
          pendingLabel="Rotating…"
          pending={rotateMutation.isPending}
          error={
            rotateMutation.isError
              ? rotateMutation.error instanceof ApiError
                ? rotateMutation.error.message
                : "Failed to rotate tray."
              : null
          }
          onCancel={() => setRotateTrayId(null)}
          onConfirm={() => rotateMutation.mutate(rotateTrayId)}
        >
          <p>
            Loads a fresh tray into this position. This day&apos;s samples and any later uses of this tray move onto
            the new cells, restarting at <b>Use 1</b>. Earlier uses stay on the old cells, which are discarded. This
            cannot be undone.
          </p>
        </ConfirmModal>
      )}
    </td>
  );
});

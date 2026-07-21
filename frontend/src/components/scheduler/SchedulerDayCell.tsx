import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import { cellsApi } from "@/api/cells";
import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { SlotIndex, CycleOut, StageOut } from "@/types/schedule";
import { formatShortDateTimeUTC } from "@/utils/calendarDates";

import { slotKey, TRAY_INDICES } from "./gridKeys";
import { padStages } from "./groupCyclesByInstrumentAndDay";
import { SchedulerSlot } from "./SchedulerSlot";
import styles from "./SchedulerDayCell.module.css";
import type { SlotSelection } from "./useSlotSelection";
import { WELL_ORDER, type CellGhost } from "./waitingCells";

export interface SchedulerDayCellProps {
  instrumentSerial: string;
  runDate: string;
  rowIndex: number;
  colIndex: number;
  weekend: boolean;
  cycle: CycleOut | undefined;
  /** An earlier run on this instrument whose lock hasn't elapsed yet, when this day has
   * no run of its own - purely informational, never affects `selectable`. */
  carryOverLock: CycleOut | undefined;
  /** No cycle yet and not a weekend - eligible for select + auto-fill. */
  selectable: boolean;
  /** Currently selected (and selectable) - via shift-click rectangle or ctrl/cmd-click toggle. */
  selected: boolean;
  placingSlotKey: string | null;
  onSelect: (r: number, c: number, shift: boolean, ctrl: boolean) => void;
  onOpenDetail: (stage: StageOut, cycle: CycleOut) => void;
  slotSelection: SlotSelection;
  /** Ctrl/cmd+shift-click on a filled slot - extends slotSelection to a rectangle
   * between the last-toggled slot and this one (see SchedulePage.onExtendSlotSelect). */
  onExtendSelect: (stage: StageOut, coord: { r: number; c: number }) => void;
  /** Waiting, reusable cells eligible to load on this instrument+day (see waitingCells.ts).
   * Ignored while the day's run is locked, since it can no longer accept placements. */
  waitingCells: CellGhost[];
  /** Wells on this instrument permanently blocked by a stopped cell (see waitingCells.
   * groupBlockedWellsByInstrument) - rendered as a non-droppable "blocked" placeholder
   * instead of the plain "+" so this well never reads as an ordinary free slot. */
  blockedWells: Set<string>;
  onOpenGhost: (ghost: CellGhost) => void;
}

/**
 * One (instrument, day) grid cell. Weekends render closed/non-interactive. Otherwise two
 * 4-slot trays (tray 2 only shown once either tray has a sample loaded), with a header carrying
 * the Confirm-loaded / Unlock control once the day's run exists. Empty non-weekend cells
 * participate in spreadsheet-style range selection for auto-fill.
 */
export function SchedulerDayCell(props: SchedulerDayCellProps) {
  const {
    instrumentSerial,
    runDate,
    rowIndex,
    colIndex,
    weekend,
    cycle,
    carryOverLock,
    selectable,
    selected,
    placingSlotKey,
    onSelect,
    slotSelection,
    onExtendSelect,
    waitingCells,
    blockedWells,
    onOpenGhost,
  } = props;
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (req: { status: "running" | "planned"; run_name?: string }) => {
      if (!cycle) throw new Error("No run to update.");
      return cyclesApi.updateStatus(cycle.cycle_id, req);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      setConfirmingLoad(false);
    },
  });

  const [confirmingLoad, setConfirmingLoad] = useState(false);
  const [runName, setRunName] = useState("");

  const [discardTrayId, setDiscardTrayId] = useState<number | null>(null);
  const discardMutation = useMutation({
    mutationFn: (trayId: number) => cellsApi.discardTray({ tray_id: trayId }),
    onSuccess: () => {
      // Every cell in the tray just flipped to exhausted and its bumped samples returned
      // to the backlog - without this, the grid's terminal/vacated-tray ghosts
      // (waitingCells.ts, fed by SchedulePage's ["cells", ...] queries) and the Backlog
      // page would keep reading pre-discard data until some unrelated mutation happened
      // to invalidate them.
      invalidateScheduleRelated(queryClient);
      setDiscardTrayId(null);
    },
  });

  if (weekend) {
    return <td className={`${styles.cell} ${styles.weekend}`} aria-hidden="true" />;
  }

  // A day with no cycle of its own is still effectively locked if an earlier run's lock
  // carries over onto it (carryOverLock) - the instrument is still physically loaded, so
  // every slot below must render as a read-only marker (or non-droppable ghost), same as
  // a genuinely locked cycle, rather than falling through to a live, droppable "+" just
  // because this exact day has no Cycle row of its own yet (see isCellOpen, which gates
  // selectability the same way).
  const locked = (cycle !== undefined && cycle.status !== "planned") || (cycle === undefined && carryOverLock !== undefined);
  const filledCount = cycle ? cycle.stages.length : 0;
  // lock_until's calendar date > this cell's own run_date - the run's lock bleeds into
  // (or past) subsequent days, worth calling out right where it started.
  const lockExtendsPastToday = cycle !== undefined && cycle.lock_until.slice(0, 10) > runDate;
  const slots = padStages(cycle);
  const tray1Filled = TRAY_INDICES[0].some((i) => slots[i] !== null);
  const tray2Filled = TRAY_INDICES[1].some((i) => slots[i] !== null);

  // A locked day can no longer accept placements, so reuse ghosts (which double as a
  // droppable "place it here" affordance) don't apply there. Unused-tray-sibling ghosts,
  // terminal ghosts, pending-terminal ghosts, and pending-reuse ghosts are different:
  // they're purely informational (a cell physically already sitting in the tray, one that's
  // simply gone terminal, one that's fully booked but hasn't reached that state as of this
  // day, or one that's still open but already claimed by its own not-yet-run next use - see
  // waitingCells.computePendingTerminalGhost / computeGhost's pendingReuseStatus branch),
  // never a placement offer, so they must stay visible even once the day is locked (see
  // "Never-yet-used tray cells" in the Schedule help section).
  // Each waiting cell is pinned to the exact slot matching its own last-used well
  // (WELL_ORDER) - cells stay in the same physical tray/well position for every reuse, never
  // just "the next open slot" - so a ghost only shows if that specific slot is free. In the
  // rare case two different waiting cells both last sat in the same well letter and are
  // eligible the same day, the first one in waitingCells order gets it; the other simply has
  // no ghost that day.
  const ghostBySlot = new Map<SlotIndex, CellGhost>();
  for (const ghost of waitingCells) {
    if (locked && !ghost.unused && !ghost.terminalStatus && !ghost.pendingTerminalStatus && !ghost.pendingReuseStatus)
      continue;
    const pinnedIndex = ghost.cell.current_well ? WELL_ORDER.indexOf(ghost.cell.current_well) : -1;
    if (pinnedIndex < 0) continue;
    const slot = pinnedIndex as SlotIndex;
    if (slots[slot] !== null || ghostBySlot.has(slot)) continue;
    ghostBySlot.set(slot, ghost);
  }
  const tray2HasGhost = TRAY_INDICES[1].some((i) => ghostBySlot.has(i));

  // A well left behind by a stopped cell (see waitingCells.groupBlockedWellsByInstrument)
  // never gets a ghost (stop_cell excludes it from reuse) and never gets a stage again, so
  // without this it would silently fall through to the plain "+" placeholder below and
  // read as an ordinary free slot - even though the physical well is permanently dead.
  const blockedSlotSet = new Set<SlotIndex>();
  WELL_ORDER.forEach((well, i) => {
    const slot = i as SlotIndex;
    if (slots[slot] === null && !ghostBySlot.has(slot) && blockedWells.has(well)) blockedSlotSet.add(slot);
  });
  const tray2HasBlocked = TRAY_INDICES[1].some((i) => blockedSlotSet.has(i));

  const trayVisible = [true, tray1Filled || tray2Filled || tray2HasGhost || tray2HasBlocked];
  // Beyond any ghost-assigned/blocked slots, still surface exactly one plain "+"
  // placeholder per tray so "use a new cell" always stays available alongside reuse ghosts.
  const firstEmptyByTray = TRAY_INDICES.map((indices) =>
    indices.find((i) => !slots[i] && !ghostBySlot.has(i) && !blockedSlotSet.has(i)),
  );

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
  if (!cycle) cellClasses.push(styles.emptyCell);

  return (
    <td
      className={cellClasses.join(" ")}
      onClick={selectable ? onCellClick : undefined}
      onKeyDown={selectable ? onCellKeyDown : undefined}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? selected : undefined}
    >
      {/* Always rendered (even with nothing to show) so every cell's tray/placeholder
          area starts at the same vertical offset within the row, whether or not this
          particular cell has a badge above it. */}
      <div className={styles.head}>
        {cycle && (
          <>
            {locked ? (
              <>
                <span
                  className={styles.lockTag}
                  title={cycle.run_name ? `Run name: ${cycle.run_name}` : undefined}
                >
                  {cycle.status === "running" ? "LOADED" : cycle.status.toUpperCase()}
                  {lockExtendsPastToday && ` · locked until ${formatShortDateTimeUTC(cycle.lock_until)}`}
                </span>
                {cycle.status === "running" && (
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
                    setRunName(cycle.run_name ?? "");
                    setConfirmingLoad(true);
                  }}
                >
                  {statusMutation.isPending ? "Confirming…" : "Confirm loaded"}
                </button>
              )
            )}
          </>
        )}

        {!cycle && carryOverLock && (
          <span className={styles.carryLockTag}>Locked until {formatShortDateTimeUTC(carryOverLock.lock_until)}</span>
        )}
      </div>

      {statusMutation.isError && (
        <div className={styles.err}>
          {statusMutation.error instanceof ApiError ? statusMutation.error.message : "Status update failed."}
        </div>
      )}

      <div className={styles.slots}>
        {TRAY_INDICES.map((indices, trayIdx) => {
          if (!trayVisible[trayIdx]) return null;
          const firstEmptyIndex = firstEmptyByTray[trayIdx];
          // Any filled slot in this tray carries the physical tray's id (see StageOut.tray_id) -
          // used to target every sibling cell, not just the ones with a filled slot this cycle.
          const trayId = indices.map((i) => slots[i]).find((s) => s?.tray_id != null)?.tray_id ?? null;
          return (
            <div key={trayIdx} className={styles.tray}>
              <div className={styles.trayHeader}>
                <div className={styles.trayLabel}>{trayIdx === 0 ? "Tray 1" : "Tray 2"}</div>
                {trayId != null && (
                  <button
                    type="button"
                    className={styles.discardBtn}
                    title="Discard all cells in this tray"
                    aria-label="Discard all cells in this tray"
                    onClick={() => setDiscardTrayId(trayId)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {indices
                .filter((i) => slots[i] !== null || i === firstEmptyIndex || ghostBySlot.has(i) || blockedSlotSet.has(i))
                .map((i) => (
                  <SchedulerSlot
                    key={i}
                    stage={slots[i]}
                    slotIndex={i}
                    instrumentSerial={instrumentSerial}
                    runDate={runDate}
                    locked={locked}
                    placing={placingSlotKey === slotKey(instrumentSerial, runDate, i)}
                    selected={
                      !locked &&
                      slots[i] !== null &&
                      slots[i]!.cell_use_status !== "cancelled" &&
                      slotSelection.isSelected(slots[i]!.cell_use_id)
                    }
                    onOpenDetail={(stage) => props.onOpenDetail(stage, cycle as CycleOut)}
                    onToggleSelect={(stage) => slotSelection.toggle(stage, { r: rowIndex, c: colIndex })}
                    onExtendSelect={(stage) => onExtendSelect(stage, { r: rowIndex, c: colIndex })}
                    ghost={ghostBySlot.get(i)}
                    blocked={blockedSlotSet.has(i)}
                    onOpenGhost={onOpenGhost}
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
            This locks the run (marks it running/LOADED) so it can no longer be edited by accident. Give it a name
            (e.g. your lab&apos;s TRACTION run id) if you&apos;d like it shown instead of the run number everywhere
            this run appears.
          </p>
        </ConfirmModal>
      )}

      {discardTrayId != null && (
        <ConfirmModal
          title="Discard all cells in this tray?"
          confirmLabel="Discard cells"
          pendingLabel="Discarding…"
          pending={discardMutation.isPending}
          error={
            discardMutation.isError
              ? discardMutation.error instanceof ApiError
                ? discardMutation.error.message
                : "Failed to discard tray."
              : null
          }
          onCancel={() => setDiscardTrayId(null)}
          onConfirm={() => discardMutation.mutate(discardTrayId)}
        >
          <p>
            This marks every cell physically in this tray as exhausted, regardless of how many uses it has left. Any
            not-yet-run placements for these cells are cancelled and their samples return to the backlog. This cannot
            be undone.
          </p>
        </ConfirmModal>
      )}
    </td>
  );
}

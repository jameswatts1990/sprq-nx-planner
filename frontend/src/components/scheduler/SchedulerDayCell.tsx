import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent, MouseEvent } from "react";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import type { SlotIndex, CycleOut, StageOut } from "@/types/schedule";
import { formatShortDateTimeUTC } from "@/utils/calendarDates";

import { slotKey, TRAY_INDICES } from "./gridKeys";
import { padStages } from "./groupCyclesByInstrumentAndDay";
import { SchedulerSlot } from "./SchedulerSlot";
import styles from "./SchedulerDayCell.module.css";
import type { SlotSelection } from "./useSlotSelection";
import type { CellGhost } from "./waitingCells";

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
  onOpenDetail: (stage: StageOut, locked: boolean) => void;
  slotSelection: SlotSelection;
  /** Source instrument of an in-progress filled-slot drag, or null. Cells cannot move
   * between instruments, so empty slots on any other instrument become ineligible. */
  activeDragInstrument: string | null;
  /** Waiting, reusable cells eligible to load on this instrument+day (see waitingCells.ts).
   * Ignored while the day's run is locked, since it can no longer accept placements. */
  waitingCells: CellGhost[];
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
    activeDragInstrument,
    waitingCells,
    onOpenGhost,
  } = props;
  const queryClient = useQueryClient();
  const crossInstrumentDragActive = activeDragInstrument !== null && activeDragInstrument !== instrumentSerial;

  const statusMutation = useMutation({
    mutationFn: (status: "running" | "planned") => {
      if (!cycle) throw new Error("No run to update.");
      return cyclesApi.updateStatus(cycle.cycle_id, { status });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
  });

  if (weekend) {
    return <td className={`${styles.cell} ${styles.weekend}`} aria-hidden="true" />;
  }

  const locked = cycle !== undefined && cycle.status !== "planned";
  const filledCount = cycle ? cycle.stages.length : 0;
  // lock_until's calendar date > this cell's own run_date - the run's lock bleeds into
  // (or past) subsequent days, worth calling out right where it started.
  const lockExtendsPastToday = cycle !== undefined && cycle.lock_until.slice(0, 10) > runDate;
  const slots = padStages(cycle);
  const tray1Filled = TRAY_INDICES[0].some((i) => slots[i] !== null);
  const tray2Filled = TRAY_INDICES[1].some((i) => slots[i] !== null);

  // A locked day can no longer accept placements, so ghosts (which double as a droppable
  // "place it here" affordance) don't apply there. Assign each waiting cell to its own
  // empty slot, tray 1 first then tray 2, so multiple simultaneously-eligible cells each
  // get a distinct tinted placeholder (see waitingCells.ts).
  const ghostBySlot = new Map<SlotIndex, CellGhost>();
  if (!locked) {
    let queue = waitingCells;
    for (const indices of TRAY_INDICES) {
      for (const i of indices) {
        if (slots[i] !== null || queue.length === 0) continue;
        ghostBySlot.set(i, queue[0]);
        queue = queue.slice(1);
      }
    }
  }
  const tray2HasGhost = TRAY_INDICES[1].some((i) => ghostBySlot.has(i));

  const trayVisible = [true, tray1Filled || tray2Filled || tray2HasGhost];
  // Beyond any ghost-assigned slots, still surface exactly one plain "+" placeholder per
  // tray so "use a new cell" always stays available alongside reuse ghosts.
  const firstEmptyByTray = TRAY_INDICES.map((indices) => indices.find((i) => !slots[i] && !ghostBySlot.has(i)));

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
  if (tray1Filled || tray2Filled) cellClasses.push(styles.twoTrays);

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
            {cycle.is_locked && (
              <span className={styles.activeDot} title="Instrument is actively sequencing this run" aria-hidden="true" />
            )}
            {locked ? (
              <>
                <span className={styles.lockTag}>
                  {cycle.status === "running" ? "LOADED" : cycle.status.toUpperCase()}
                  {lockExtendsPastToday && ` · locked until ${formatShortDateTimeUTC(cycle.lock_until)}`}
                </span>
                {cycle.status === "running" && (
                  <button
                    type="button"
                    className={styles.ctrl}
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate("planned")}
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
                  onClick={() => statusMutation.mutate("running")}
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
          return (
            <div key={trayIdx} className={styles.tray}>
              {trayIdx === 1 && <div className={styles.trayLabel}>Tray 2</div>}
              {indices
                .filter((i) => slots[i] !== null || i === firstEmptyIndex || ghostBySlot.has(i))
                .map((i) => (
                  <SchedulerSlot
                    key={i}
                    stage={slots[i]}
                    slotIndex={i}
                    instrumentSerial={instrumentSerial}
                    runDate={runDate}
                    locked={locked}
                    placing={placingSlotKey === slotKey(instrumentSerial, runDate, i)}
                    selected={!locked && slots[i] !== null && slotSelection.isSelected(slots[i]!.cell_use_id)}
                    onOpenDetail={(stage) => props.onOpenDetail(stage, locked)}
                    onToggleSelect={slotSelection.toggle}
                    crossInstrumentDragActive={crossInstrumentDragActive}
                    ghost={ghostBySlot.get(i)}
                    onOpenGhost={onOpenGhost}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </td>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent, MouseEvent } from "react";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import type { CycleOut, StageOut } from "@/types/schedule";

import { SLOT_INDICES, slotKey } from "./gridKeys";
import { padStages } from "./groupCyclesByInstrumentAndDay";
import { SchedulerSlot } from "./SchedulerSlot";
import styles from "./SchedulerDayCell.module.css";
import type { SlotSelection } from "./useSlotSelection";

export interface SchedulerDayCellProps {
  instrumentSerial: string;
  runDate: string;
  rowIndex: number;
  colIndex: number;
  weekend: boolean;
  cycle: CycleOut | undefined;
  /** No cycle yet and not a weekend - eligible for select + auto-fill. */
  selectable: boolean;
  /** Currently selected (and selectable) - via shift-click rectangle or ctrl/cmd-click toggle. */
  selected: boolean;
  placingSlotKey: string | null;
  onSelect: (r: number, c: number, shift: boolean, ctrl: boolean) => void;
  onOpenDetail: (stage: StageOut, locked: boolean) => void;
  slotSelection: SlotSelection;
}

/**
 * One (instrument, day) grid cell. Weekends render closed/non-interactive. Otherwise a
 * 2x2 bank of 4 fixed slots, with a header carrying the Confirm-loaded / Unlock control
 * once the day's run exists. Empty non-weekend cells participate in spreadsheet-style
 * range selection for auto-fill.
 */
export function SchedulerDayCell(props: SchedulerDayCellProps) {
  const {
    instrumentSerial,
    runDate,
    rowIndex,
    colIndex,
    weekend,
    cycle,
    selectable,
    selected,
    placingSlotKey,
    onSelect,
    slotSelection,
  } = props;
  const queryClient = useQueryClient();

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
  const slots = padStages(cycle);
  const firstEmptyIndex = SLOT_INDICES.find((i) => !slots[i]);

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
      {cycle && (
        <div className={styles.head}>
          {locked ? (
            <>
              <span className={styles.lockTag}>{cycle.status === "running" ? "LOADED" : cycle.status.toUpperCase()}</span>
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
        </div>
      )}

      {statusMutation.isError && (
        <div className={styles.err}>
          {statusMutation.error instanceof ApiError ? statusMutation.error.message : "Status update failed."}
        </div>
      )}

      <div className={styles.slots}>
        {SLOT_INDICES.filter((i) => slots[i] !== null || i === firstEmptyIndex).map((i) => (
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
          />
        ))}
      </div>
    </td>
  );
}

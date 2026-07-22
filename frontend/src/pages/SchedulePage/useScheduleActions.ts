import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { schedulerApi } from "@/api/schedulerGrid";
import type { NoteTone } from "@/components/ui/Note";
import type { GridSelection } from "@/components/scheduler/useGridSelection";
import type { SlotSelection } from "@/components/scheduler/useSlotSelection";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";

export interface AccordionNote {
  tone: NoteTone;
  icon: string;
  text: string;
}

export interface UseScheduleActionsArgs {
  selection: GridSelection;
  slotSelection: SlotSelection;
  /** The concrete, currently-selectable empty cells for auto-fill (see SchedulePage). */
  selectedCells: GridCellRef[];
  runDesign: RunDesignState;
  /** Every planned (unlocked) stage in the visible week, for the bulk "Clear schedule". */
  weekPlannedStages: StageOut[];
}

/**
 * Owns every mutating action the weekly schedule offers - remove-selected, drag-remove,
 * swap, bulk clear, and auto-schedule - together with the two bits of user feedback they
 * drive (the Run Design accordion note and the toolbar remove-error) and the clear-confirm
 * modal flag. Extracted from SchedulePage so the page is left with layout, queries,
 * selection and drag/drop wiring; every "what happens when you do X" lives here.
 *
 * Behaviour is identical to the previous inline mutations - each still re-derives its work
 * from the live selection/backlog and invalidates the shared schedule query keys on success.
 */
export function useScheduleActions({
  selection,
  slotSelection,
  selectedCells,
  runDesign,
  weekPlannedStages,
}: UseScheduleActionsArgs) {
  const queryClient = useQueryClient();

  const [runDesignNote, setRunDesignNote] = useState<AccordionNote | null>(null);
  const [removeSlotsError, setRemoveSlotsError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const removeSlots = useMutation({
    mutationFn: async () => {
      const stages = slotSelection.selectedStages;
      const results = await Promise.allSettled(stages.map((stage) => cellUsesApi.remove(stage.cell_use_id)));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      return { total: stages.length, failed: failed.length, firstError: failed[0] };
    },
    onSuccess: ({ total, failed, firstError }) => {
      invalidateScheduleRelated(queryClient);
      slotSelection.clear();
      if (failed === 0) {
        setRemoveSlotsError(null);
      } else {
        const detail = firstError?.reason instanceof ApiError ? firstError.reason.message : undefined;
        setRemoveSlotsError(
          `${total - failed} of ${total} sample(s) removed; ${failed} could not be removed${detail ? ` (${detail})` : ""}.`,
        );
      }
    },
    onError: (err) => {
      // Defensive only - mutationFn resolves via Promise.allSettled and shouldn't reject.
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to remove selected samples.");
    },
  });

  // Dragging a placed sample off its slot and dropping it somewhere that isn't a valid
  // grid slot (e.g. off the grid entirely) removes it from the schedule - the drag
  // equivalent of the "Remove from schedule" action.
  const dragRemove = useMutation({
    mutationFn: (cellUseId: number) => cellUsesApi.remove(cellUseId),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
    },
    onError: (err) => {
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to remove sample from schedule.");
    },
  });

  // Dragging a placed sample onto a *different* already-occupied slot swaps the two
  // samples' placements - the drag-and-drop equivalent of moving each into the other's
  // slot in one step.
  const swap = useMutation({
    mutationFn: ({ a, b }: { a: number; b: number }) => cellUsesApi.swap(a, b),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
    },
    onError: (err) => {
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to swap samples.");
    },
  });

  // Bulk-remove every planned (unlocked) sample in the currently-viewed week - gated
  // behind the confirm modal since it's destructive and can span every instrument.
  const clearSchedule = useMutation({
    mutationFn: async () => {
      const stages = weekPlannedStages;
      const results = await Promise.allSettled(stages.map((stage) => cellUsesApi.remove(stage.cell_use_id)));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      return { total: stages.length, succeeded: stages.length - failed.length, failed: failed.length, firstError: failed[0] };
    },
    onSuccess: ({ total, succeeded, failed, firstError }) => {
      invalidateScheduleRelated(queryClient);
      setClearConfirmOpen(false);
      if (failed === 0) {
        setRunDesignNote({ tone: "good", icon: "✓", text: `${succeeded} sample(s) cleared from the schedule.` });
      } else {
        const detail = firstError?.reason instanceof ApiError ? firstError.reason.message : undefined;
        setRunDesignNote({
          tone: "warn",
          icon: "!",
          text: `${succeeded} of ${total} sample(s) cleared; ${failed} could not be removed${detail ? ` (${detail})` : ""}.`,
        });
      }
    },
    onError: (err) => {
      // Defensive only - mutationFn resolves via Promise.allSettled and shouldn't reject.
      setRunDesignNote({
        tone: "bad",
        icon: "!",
        text: err instanceof ApiError ? err.message : "Failed to clear schedule.",
      });
    },
  });

  const autoFill = useMutation({
    mutationFn: () =>
      schedulerApi.autoFill({
        cells: selectedCells,
        max_uses: runDesign.max_uses,
        run_time_hours: runDesign.run_time_hours,
        objective: runDesign.objective,
        cells_per_day: runDesign.cells_per_day,
      }),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      selection.clear();
      const parts = [`${res.placed_sample_ids.length} placed`];
      if (res.unplaced_sample_ids.length > 0) parts.push(`${res.unplaced_sample_ids.length} unplaced`);
      if (res.skipped_cells.length > 0) parts.push(`${res.skipped_cells.length} cell(s) skipped`);
      if (res.window_flags.length > 0) parts.push(`${res.window_flags.length} window flag(s)`);
      if (res.barcode_conflicts.length > 0) parts.push(`${res.barcode_conflicts.length} barcode conflict(s)`);
      const clean =
        res.unplaced_sample_ids.length === 0 && res.window_flags.length === 0 && res.barcode_conflicts.length === 0;
      setRunDesignNote({
        tone: clean ? "good" : "warn",
        icon: clean ? "✓" : "!",
        text: parts.join(" · "),
      });
    },
    onError: (err) => {
      setRunDesignNote({
        tone: "bad",
        icon: "!",
        text: err instanceof ApiError ? err.message : "Auto-schedule failed.",
      });
    },
  });

  const onRequestClearSchedule = useCallback(() => {
    setRunDesignNote(null);
    clearSchedule.reset();
    setClearConfirmOpen(true);
  }, [clearSchedule]);

  const onAutoSchedule = useCallback(() => {
    setRunDesignNote(null);
    autoFill.mutate();
  }, [autoFill]);

  // Clears all transient feedback/modal state - called when the visible window pages.
  const resetFeedback = useCallback(() => {
    setRunDesignNote(null);
    setRemoveSlotsError(null);
    setClearConfirmOpen(false);
  }, []);

  return {
    runDesignNote,
    removeSlotsError,
    clearConfirmOpen,
    setClearConfirmOpen,
    removeSlots,
    dragRemove,
    swap,
    clearSchedule,
    autoFill,
    onRequestClearSchedule,
    onAutoSchedule,
    resetFeedback,
  };
}

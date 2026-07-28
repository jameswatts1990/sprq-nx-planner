import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { schedulerApi } from "@/api/schedulerGrid";
import type { NoteTone } from "@/components/ui/Note";
import type { GridSelection } from "@/components/scheduler/useGridSelection";
import type { SlotSelection } from "@/components/scheduler/useSlotSelection";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { RunOut, SlotIndex, StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateTimeUTC, formatTimeUTC } from "@/utils/calendarDates";

export interface AccordionNote {
  tone: NoteTone;
  icon: string;
  text: string;
}

/** A one-line advisory when a just-placed/moved run's cells will actually break out LATER than the
 * load time the user chose, because the instrument is busy (cross-run sequencing contention - see
 * cell_timing.instrument_timeline). The load isn't blocked or moved; this just tells the user when
 * sequencing really starts. null when the run starts when requested. */
function placementAdvisoryText(run: RunOut): string | null {
  if (!run.starts_later_than_requested || !run.effective_start_at) return null;
  const plate1 = run.plates.find((p) => p.plate_index === 1) ?? run.plates[0];
  const loaded = plate1 ? formatTimeUTC(plate1.planned_start_at) : "your chosen time";
  return `${run.instrument_serial} is busy — this run loads at ${loaded}, but its cells won't start sequencing until ${formatShortDateTimeUTC(run.effective_start_at)}.`;
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
  // A transient advisory shown after a drop/move onto a busy instrument: "loaded 12:00, cells
  // really start 18:00". Distinct from removeSlotsError (a red failure) - this is informational.
  const [placementAdvisory, setPlacementAdvisory] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const removeSlots = useMutation({
    // One atomic request, not one DELETE per stage: the backend removes every stage in a
    // single transaction, so it can't race the empty-plate cleanup and leave an orphaned
    // cycle behind (a stale instrument lock - see cellUsesApi.bulkRemove).
    mutationFn: () => cellUsesApi.bulkRemove(slotSelection.selectedStages.map((s) => s.cell_use_id)),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      slotSelection.clear();
      if (res.failed.length === 0) {
        setRemoveSlotsError(null);
      } else {
        const total = res.removed_count + res.failed.length;
        setRemoveSlotsError(
          `${res.removed_count} of ${total} sample(s) removed; ${res.failed.length} could not be removed (${res.failed[0].reason}).`,
        );
      }
    },
    onError: (err) => {
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
    // One atomic request (see removeSlots): clearing a whole week in a single transaction is
    // what stops a half-emptied run - the exact orphaned-cycle-projects-a-stale-lock bug the
    // lab owner hit after a Clear left "locks" on days with nothing scheduled.
    mutationFn: () => cellUsesApi.bulkRemove(weekPlannedStages.map((s) => s.cell_use_id)),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      setClearConfirmOpen(false);
      if (res.failed.length === 0) {
        setRunDesignNote({ tone: "good", icon: "✓", text: `${res.removed_count} sample(s) cleared from the schedule.` });
      } else {
        const total = res.removed_count + res.failed.length;
        setRunDesignNote({
          tone: "warn",
          icon: "!",
          text: `${res.removed_count} of ${total} sample(s) cleared; ${res.failed.length} could not be removed (${res.failed[0].reason}).`,
        });
      }
    },
    onError: (err) => {
      setRunDesignNote({
        tone: "bad",
        icon: "!",
        text: err instanceof ApiError ? err.message : "Failed to clear schedule.",
      });
    },
  });

  // A plain drag-drop of a backlog sample onto an empty slot: place it and let the BACKEND
  // derive the cell (reuse-before-new - see placement_service.derive_best_cell). No cell_choice
  // is sent, so there's no drop-time picker; the derived cell shows as the card's cell stub, and
  // the "use a different cell" override is reached from there. (A drop directly onto a reuse
  // ghost still goes through the CellChoicePicker instead - see useSchedulerDnd - so an explicit
  // ghost target, and any barcode clash on it, is honoured/surfaced rather than silently
  // re-derived.)
  const autoPlace = useMutation({
    mutationFn: (v: {
      sample_id: number;
      instrument_serial: string;
      load_date: string;
      slot_index: SlotIndex;
      // Only meaningful when this drop creates a brand-new run (the first sample onto an
      // empty instrument+day) - sets that run's load/start hour. Ignored otherwise.
      start_hour?: number;
      start_minute?: number;
    }) =>
      cellUsesApi.place({
        sample_id: v.sample_id,
        instrument_serial: v.instrument_serial,
        load_date: v.load_date,
        slot_index: v.slot_index,
        // No run_time_hours: a manual drop inherits the sample's own movie time
        // (Sample.movie_time_hours, default 24 h) - resolved server-side in place_sample.
        start_hour: v.start_hour,
        start_minute: v.start_minute,
      }),
    onSuccess: (run) => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
      setPlacementAdvisory(placementAdvisoryText(run));
    },
    onError: (err) => {
      setPlacementAdvisory(null);
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to place sample.");
    },
  });

  // A drag-move of an already-placed sample. No cell_choice and no drop-time picker: the
  // backend keeps the sample's own physical cell for a same-carousel-position reschedule, or
  // auto-derives the next-usable cell (reuse-before-new) when the move crosses instruments or
  // carousel positions (see placement_service.move_sample). A grid slot is a loading position,
  // not a cell, so which cell backs the moved sample is decided server-side and shown on the
  // card's stub. run_time_hours is required by the request but ignored for a move (the moved
  // placement keeps its own).
  const move = useMutation({
    mutationFn: (v: { cell_use_id: number; instrument_serial: string; load_date: string; slot_index: SlotIndex }) =>
      cellUsesApi.move(v.cell_use_id, {
        instrument_serial: v.instrument_serial,
        load_date: v.load_date,
        slot_index: v.slot_index,
        run_time_hours: runDesign.run_time_hours,
      }),
    onSuccess: (run) => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
      setPlacementAdvisory(placementAdvisoryText(run));
    },
    onError: (err) => {
      setPlacementAdvisory(null);
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to move sample.");
    },
  });

  const autoFill = useMutation({
    mutationFn: () =>
      schedulerApi.autoFill({
        cells: selectedCells,
        max_uses: runDesign.max_uses,
        // Only these movie times are pulled from the backlog; each well then runs for its own
        // sample's movie time (12 h -> cell 1, 30 h -> cell 4, 24 h anywhere).
        movie_times: runDesign.movie_times,
        objective: runDesign.objective,
        cells_per_day: runDesign.cells_per_day,
        // Every run this batch creates loads/starts at the Run design load hour.
        start_hour: runDesign.load_hour,
      }),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      selection.clear();
      const parts = [`${res.placed_sample_ids.length} placed`];
      if (res.unplaced_sample_ids.length > 0) parts.push(`${res.unplaced_sample_ids.length} unplaced`);
      if (res.skipped_cells.length > 0) parts.push(`${res.skipped_cells.length} cell(s) skipped`);
      if (res.window_flags.length > 0) parts.push(`${res.window_flags.length} window flag(s)`);
      if (res.barcode_conflicts.length > 0) parts.push(`${res.barcode_conflicts.length} barcode conflict(s)`);
      // Auto-disposal is the expected outcome of the Max-uses cap, not a problem - report
      // it for transparency but don't let it flip the note to a warning tone.
      if (res.disposed_cell_ids.length > 0) parts.push(`${res.disposed_cell_ids.length} cell(s) disposed`);
      // Runs whose cells will break out later than their load because the instrument is busy
      // (cross-run lane contention) - informational, like disposals, not a warning.
      const queued = res.runs.filter((r) => r.starts_later_than_requested).length;
      if (queued > 0) parts.push(`${queued} run(s) start later (instrument busy)`);
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
    setPlacementAdvisory(null);
    setClearConfirmOpen(false);
  }, []);

  return {
    runDesignNote,
    removeSlotsError,
    placementAdvisory,
    setPlacementAdvisory,
    clearConfirmOpen,
    setClearConfirmOpen,
    removeSlots,
    dragRemove,
    swap,
    autoPlace,
    move,
    clearSchedule,
    autoFill,
    onRequestClearSchedule,
    onAutoSchedule,
    resetFeedback,
  };
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { schedulerApi } from "@/api/schedulerGrid";
import type { NoteTone } from "@/components/ui/Note";
import type { GridSelection } from "@/components/scheduler/useGridSelection";
import type { SlotSelection } from "@/components/scheduler/useSlotSelection";
import { smallInsertReuseWarning, useInsertSizeThreshold } from "@/hooks/useInsertSizeThreshold";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { RunOut, SlotIndex, StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateTimeLocal, formatTimeLocal, localWallTimeToUtcParts } from "@/utils/calendarDates";

export interface AccordionNote {
  tone: NoteTone;
  icon: string;
  text: string;
}

/** Swap's own request only needs the two cell_use_ids. */
interface SwapVars {
  a: number;
  b: number;
}

/** One or two advisory sentences for a just-placed/moved run, combining two independent,
 * non-blocking checks - both only ever populated on a placement/move/auto-fill response (see
 * RunOut.effective_start_at and StageOut.reuse_not_ready_hours), never on the plain grid feed,
 * so this must run off the mutation's own response rather than any later-refetched data. null
 * when neither applies. */
function placementAdvisoryText(run: RunOut, insertThreshold: number): string | null {
  const parts: string[] = [];
  if (run.starts_later_than_requested && run.effective_start_at) {
    const plate1 = run.plates.find((p) => p.plate_index === 1) ?? run.plates[0];
    const loaded = plate1 ? formatTimeLocal(plate1.planned_start_at) : "your chosen time";
    parts.push(
      `${run.instrument_serial} is busy — this run loads at ${loaded}, but its cells won't start sequencing until ${formatShortDateTimeLocal(run.effective_start_at)}.`,
    );
  }
  // Advisory only, never blocks a placement - a distinct clock from the instrument-busy check
  // above (see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate simplifications").
  // Worst shortfall across this run's stages, mirroring how starts_later_than_requested is
  // itself already a run-level (not stage-level) rollup.
  const shortfall = Math.max(0, ...run.plates.flatMap((p) => p.stages.map((s) => s.reuse_not_ready_hours ?? 0)));
  if (shortfall > 0) {
    parts.push(
      `A reused cell in this run is scheduled about ${shortfall.toFixed(1)}h before its own wash-and-movie math says it can physically be ready.`,
    );
  }
  // A small-insert (<= threshold) library on a cell's 2nd/3rd use. Auto Schedule avoids this
  // outright; a manual drag/move is allowed but warned (PacBio flags reduced yield on re-use).
  const smallOnReuse = run.plates.some((p) =>
    p.stages.some((s) => s.use_number >= 2 && s.insert_size_bp != null && s.insert_size_bp <= insertThreshold),
  );
  if (smallOnReuse) parts.push(smallInsertReuseWarning(insertThreshold));
  return parts.length > 0 ? parts.join(" ") : null;
}

/** "3 unplaced (TRAC-2-26296, TRAC-2-26301, TRAC-2-26305 and 1 more)" - names WHICH samples
 * landed back in the Backlog instead of just a count, so a user isn't left hunting for them
 * (see the Samples page's all-status search, HistorySamplesPage.tsx). Truncated to the first
 * 3 Container IDs to keep the note short. */
function unplacedNote(count: number, externalIds: string[]): string {
  if (count === 0) return "";
  const shown = externalIds.slice(0, 3);
  const rest = externalIds.length - shown.length;
  const names = shown.length > 0 ? ` (${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""})` : "";
  return `${count} unplaced${names}`;
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
  const insertThreshold = useInsertSizeThreshold();

  const [runDesignNote, setRunDesignNote] = useState<AccordionNote | null>(null);
  const [removeSlotsError, setRemoveSlotsError] = useState<string | null>(null);
  // A drop rejected before ever reaching the backend - a backlog sample dropped onto an
  // already-occupied slot, or any drop landing on a locked/blocked/weekend/down area (see
  // useSchedulerDnd's onDropBlocked). These used to be silent no-ops (or, worse, a silent
  // deletion - see onRemoveOutside); this is the message that now explains why nothing (or
  // something destructive) didn't happen. Cleared on the next successful drag-driven mutation
  // so it never lingers past whatever the user does next.
  const [dropBlockedMessage, setDropBlockedMessage] = useState<string | null>(null);
  const onDropBlocked = useCallback((message: string) => setDropBlockedMessage(message), []);
  // A transient advisory shown after a drop/move onto a busy instrument: "loaded 12:00, cells
  // really start 18:00". Distinct from removeSlotsError (a red failure) - this is informational.
  const [placementAdvisory, setPlacementAdvisory] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Instrument serial pending/undergoing a "Recalculate" confirm, or null when the modal is closed.
  const [recalculateTarget, setRecalculateTarget] = useState<string | null>(null);
  // Recalculate's own result note - kept separate from runDesignNote, which only ever renders
  // inside the Autoschedule drawer. Recalculate is triggered from an instrument row's own
  // confirm modal, not the drawer, so a note stuffed into runDesignNote here would be computed
  // and then never actually shown unless the user happened to already have the drawer open.
  // Rendered directly on the schedule page instead (see SchedulePage.tsx).
  const [recalculateNote, setRecalculateNote] = useState<AccordionNote | null>(null);

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
      setDropBlockedMessage(null);
    },
    onError: (err) => {
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to remove sample from schedule.");
    },
  });

  // Dragging a placed sample onto a *different* already-occupied slot swaps the two
  // samples' placements - the drag-and-drop equivalent of moving each into the other's
  // slot in one step.
  const swap = useMutation({
    mutationFn: ({ a, b }: SwapVars) => cellUsesApi.swap(a, b),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
      setDropBlockedMessage(null);
    },
    onError: (err) => {
      // A swap never fails on a barcode clash any more (warn, don't block - the clash lands and
      // is flagged on the card). Any error here is something else (locked run, etc.).
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
  // the "use a different cell"/"choose a specific cell" overrides (CellInfoPopover) are reached
  // from there instead.
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
      setDropBlockedMessage(null);
      setPlacementAdvisory(placementAdvisoryText(run, insertThreshold));
    },
    onError: (err) => {
      // A plain drop is never blocked for a barcode clash (warn, don't block); any failure here
      // is something else (locked day, occupied slot, ...).
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
      setDropBlockedMessage(null);
      setPlacementAdvisory(placementAdvisoryText(run, insertThreshold));
    },
    onError: (err) => {
      // A move is never blocked for a barcode clash (warn, don't block); any failure here is
      // something else (locked run, occupied slot, ...).
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
        // Every run this batch creates loads/starts at the Run design load hour, picked on the
        // lab's local wall clock. Convert to the UTC hour/minute the backend stores, using the
        // earliest selected day for the offset (see localWallTimeToUtcParts's DST-range note).
        ...(() => {
          const anchor = selectedCells.map((c) => c.load_date).sort()[0];
          const utc = anchor
            ? localWallTimeToUtcParts(anchor, runDesign.load_hour, 0)
            : { hour: runDesign.load_hour, minute: 0 };
          return { start_hour: utc.hour, start_minute: utc.minute };
        })(),
      }),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      selection.clear();
      const parts = [`${res.placed_sample_ids.length} placed`];
      if (res.unplaced_sample_ids.length > 0) {
        parts.push(unplacedNote(res.unplaced_sample_ids.length, res.unplaced_external_ids));
      }
      if (res.skipped_cells.length > 0) parts.push(`${res.skipped_cells.length} cell(s) skipped`);
      if (res.window_flags.length > 0) parts.push(`${res.window_flags.length} window flag(s)`);
      // Advisory only, never blocks a placement - a distinct clock from window_flags' 108h
      // lifetime check (see docs/pacbio-sprq-nx-scheduling-reference.md's "Deliberate
      // simplifications").
      if (res.reuse_timing_flags.length > 0) {
        parts.push(`${res.reuse_timing_flags.length} reuse-timing flag(s)`);
      }
      if (res.barcode_conflicts.length > 0) parts.push(`${res.barcode_conflicts.length} barcode conflict(s)`);
      // Auto-disposal is the expected outcome of the Max-uses cap, not a problem - report
      // it for transparency but don't let it flip the note to a warning tone.
      if (res.disposed_cell_ids.length > 0) parts.push(`${res.disposed_cell_ids.length} cell(s) disposed`);
      // Runs whose cells will break out later than their load because the instrument is busy
      // (cross-run lane contention) - informational, like disposals, not a warning.
      const queued = res.runs.filter((r) => r.starts_later_than_requested).length;
      if (queued > 0) parts.push(`${queued} run(s) start later (instrument busy)`);
      const clean =
        res.unplaced_sample_ids.length === 0 &&
        res.window_flags.length === 0 &&
        res.reuse_timing_flags.length === 0 &&
        res.barcode_conflicts.length === 0;
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

  // "Recalculate" next to an instrument's name: re-pack every not-yet-loaded placement on
  // that one instrument from scratch under the current engine rules (see
  // auto_fill_service.recalculate_instrument) - for a schedule built under a since-corrected
  // rule. recalculateTarget holds the instrument serial pending confirmation (or mid-flight);
  // null closes the modal.
  const recalculate = useMutation({
    mutationFn: (instrumentSerial: string) => schedulerApi.recalculate({ instrument_serial: instrumentSerial }),
    onSuccess: (res, instrumentSerial) => {
      invalidateScheduleRelated(queryClient);
      setRecalculateTarget(null);
      const parts = [`${res.placed_sample_ids.length} placed`];
      if (res.unplaced_sample_ids.length > 0) {
        parts.push(unplacedNote(res.unplaced_sample_ids.length, res.unplaced_external_ids));
      }
      // Recalculate re-packs across a wider day range than an ordinary Auto Schedule call, so
      // it's the flow most likely to hit deep cross-run reuse - surface both timing flags here
      // too (window_flags previously wasn't shown on this mutation at all).
      if (res.window_flags.length > 0) parts.push(`${res.window_flags.length} window flag(s)`);
      if (res.reuse_timing_flags.length > 0) {
        parts.push(`${res.reuse_timing_flags.length} reuse-timing flag(s)`);
      }
      if (res.barcode_conflicts.length > 0) parts.push(`${res.barcode_conflicts.length} barcode conflict(s)`);
      if (res.disposed_cell_ids.length > 0) parts.push(`${res.disposed_cell_ids.length} cell(s) disposed`);
      // A day change is a bigger deal than an ordinary cell/tray reassignment (it can affect
      // staffing/collaborator commitments), so call it out on its own rather than folding it
      // into "placed" - see docs/pacbio-sprq-nx-scheduling-reference.md's "Recalculate" section.
      if (res.day_changed_sample_ids.length > 0) {
        parts.push(`${res.day_changed_sample_ids.length} sample(s) moved to a different day`);
      }
      const clean =
        res.unplaced_sample_ids.length === 0 &&
        res.window_flags.length === 0 &&
        res.reuse_timing_flags.length === 0 &&
        res.barcode_conflicts.length === 0 &&
        res.day_changed_sample_ids.length === 0;
      setRecalculateNote({
        tone: clean ? "good" : "warn",
        icon: clean ? "✓" : "!",
        text: `${instrumentSerial} recalculated: ${parts.join(" · ")}`,
      });
    },
    onError: (err) => {
      setRecalculateNote({
        tone: "bad",
        icon: "!",
        text: err instanceof ApiError ? err.message : "Failed to recalculate.",
      });
    },
  });

  const onRequestRecalculate = useCallback((instrumentSerial: string) => {
    setRecalculateNote(null);
    recalculate.reset();
    setRecalculateTarget(instrumentSerial);
  }, [recalculate]);

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
    setDropBlockedMessage(null);
    setPlacementAdvisory(null);
    setClearConfirmOpen(false);
    setRecalculateTarget(null);
    setRecalculateNote(null);
  }, []);

  return {
    runDesignNote,
    removeSlotsError,
    dropBlockedMessage,
    onDropBlocked,
    placementAdvisory,
    setPlacementAdvisory,
    clearConfirmOpen,
    setClearConfirmOpen,
    recalculateTarget,
    setRecalculateTarget,
    recalculateNote,
    removeSlots,
    dragRemove,
    swap,
    autoPlace,
    move,
    clearSchedule,
    autoFill,
    recalculate,
    onRequestClearSchedule,
    onRequestRecalculate,
    onAutoSchedule,
    resetFeedback,
  };
}

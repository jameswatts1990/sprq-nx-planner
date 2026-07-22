import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cellUsesApi } from "@/api/cellUses";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { schedulerApi } from "@/api/schedulerGrid";
import { CellChoicePicker } from "@/components/scheduler/CellChoicePicker";
import {
  findCarryOverLock,
  groupCyclesByInstrumentAndDay,
  isCellOpen,
  LOCK_LOOKBACK_DAYS,
} from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { SchedulerGrid } from "@/components/scheduler/SchedulerGrid";
import { SlotDetailPopover } from "@/components/scheduler/SlotDetailPopover";
import { CellLinkContext, useCellLinkHighlight } from "@/components/scheduler/useCellLinkHighlight";
import { useGridSelection } from "@/components/scheduler/useGridSelection";
import { useSchedulerDnd } from "@/components/scheduler/useSchedulerDnd";
import { useSlotSelection } from "@/components/scheduler/useSlotSelection";
import {
  computeBlockedWellsByInstrumentAndDay,
  computeTrayDisposalWarnings,
  computeTrayEvictionDates,
  computeTrayFoundingDates,
  computeVacatedTrayIds,
  groupWaitingCellsByInstrumentAndDay,
  type CellGhost,
} from "@/components/scheduler/waitingCells";
import { WaitingCellPopover } from "@/components/scheduler/WaitingCellPopover";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Button } from "@/components/ui/Button";
import type { NoteTone } from "@/components/ui/Note";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CycleOut, StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";
import { addDaysUTC, formatShortDateUTC, isWeekendUTC, parseDateOnly, toIsoDateUTC } from "@/utils/calendarDates";

import { BacklogAccordion } from "./BacklogAccordion";
import { ClearScheduleModal } from "./ClearScheduleModal";
import { PrintBatchSheetModal } from "./PrintBatchSheetModal";
import { RunDesignAccordion } from "./RunDesignAccordion";
import styles from "./SchedulePage.module.css";
import { useSchedulerWindow } from "./useSchedulerWindow";

const DEFAULT_RUN_DESIGN: RunDesignState = {
  max_uses: 3,
  run_time_hours: 24,
  objective: "fewest",
  cells_per_day: 8,
};

interface DetailTarget {
  stage: StageOut;
  cycle: CycleOut;
}

interface AccordionNote {
  tone: NoteTone;
  icon: string;
  text: string;
}

export function SchedulePage() {
  const queryClient = useQueryClient();
  const win = useSchedulerWindow();
  const selection = useGridSelection();
  const slotSelection = useSlotSelection();

  const [runDesign, setRunDesign] = useState<RunDesignState>(DEFAULT_RUN_DESIGN);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [runDesignNote, setRunDesignNote] = useState<AccordionNote | null>(null);
  const [removeSlotsError, setRemoveSlotsError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [printSheetOpen, setPrintSheetOpen] = useState(false);
  const [ghostDetail, setGhostDetail] = useState<CellGhost | null>(null);
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const accordionsRef = useRef<HTMLDivElement>(null);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  // Fetch a few days further back than the visible window so a long run that started
  // just before it (still locking its instrument) is known about for the carry-over lock
  // badge, even though its own day isn't rendered as a column.
  const lookbackDateFrom = useMemo(
    () => toIsoDateUTC(addDaysUTC(parseDateOnly(win.dateFrom), -LOCK_LOOKBACK_DAYS)),
    [win.dateFrom],
  );
  const cyclesQuery = useQuery({
    queryKey: ["cycles", { date_from: lookbackDateFrom, date_to: win.dateTo }],
    queryFn: () => cyclesApi.list({ date_from: lookbackDateFrom, date_to: win.dateTo }),
    placeholderData: (prev) => prev,
    // Keeps each run's is_locked (active/sequencing indicator) reasonably current for
    // anyone leaving this page open, without a client-side clock re-deriving it.
    refetchInterval: 60_000,
  });

  // Every open cell still holding unused capacity, regardless of instrument - drives the
  // weekly grid's "waiting cell" ghost indicators (see waitingCells.ts). No dedicated
  // invalidation needed: every mutation that can change a cell's state (place/remove/move/
  // retire) already invalidates the ["cells"] query-key prefix.
  const waitingCellsQuery = useQuery({
    queryKey: ["cells", "waiting-ghosts"],
    queryFn: () => cellsApi.listAll({ status: "open" }),
  });

  // Every stopped cell, regardless of instrument - drives the "blocked well" placeholder
  // (see waitingCells.groupBlockedWellsByInstrument) so a permanently dead well doesn't
  // look like an ordinary free "+" slot. Same invalidation story as waitingCellsQuery.
  const blockedCellsQuery = useQuery({
    queryKey: ["cells", "blocked-wells"],
    queryFn: () => cellsApi.listAll({ status: "stopped" }),
  });

  // Every cell that's gone terminal by ordinary attrition (not a QC stop) - drives the
  // "terminal ghost" marker (see waitingCells.computeTerminalGhost) so a well that simply
  // ran out of lawful uses or 108h capacity doesn't silently look identical to one that
  // never held anything. Same invalidation story as waitingCellsQuery.
  const terminalCellsQuery = useQuery({
    queryKey: ["cells", "terminal-wells"],
    queryFn: () => cellsApi.listAll({ status: "exhausted,window_expired,retired" }),
  });

  const instrumentSerials = useMemo(
    () => (instrumentsQuery.data ?? []).map((i) => i.serial_number),
    [instrumentsQuery.data],
  );
  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const grouped = useMemo(() => groupCyclesByInstrumentAndDay(cycles), [cycles]);
  // The full tray-linked cell universe (open + terminal + stopped) - several tray-level
  // derivations below need visibility into every status a tray-linked cell can be in, not
  // just the open+terminal cells the reuse ghosts are built from: a since-terminal or
  // stopped sibling still anchors its tray's founding date and its vacated/occupied state,
  // and a stopped well's block must know when a *later* tray takes the well over.
  const allTrayCells = useMemo(
    () => [...(waitingCellsQuery.data ?? []), ...(terminalCellsQuery.data ?? []), ...(blockedCellsQuery.data ?? [])],
    [waitingCellsQuery.data, terminalCellsQuery.data, blockedCellsQuery.data],
  );
  // Whether a terminal cell's physical tray has been fully vacated (see
  // waitingCells.computeVacatedTrayIds) - a still-open or stopped sibling missing from the
  // check would wrongly read as "no capacity left anywhere in this tray".
  const vacatedTrayIds = useMemo(() => computeVacatedTrayIds(allTrayCells), [allTrayCells]);
  // A tray's founding cell may itself have since gone terminal or been stopped, and its
  // planned first-use date must still anchor its still-open siblings' ghosts (see
  // waitingCells.computeTrayFoundingDates).
  const trayFoundingDates = useMemo(() => computeTrayFoundingDates(allTrayCells), [allTrayCells]);
  // The day each physical tray is evicted by a successor tray founded in the same carousel
  // position - past it, none of that tray's cells can be reused or shown, since a cell keeps a
  // fixed tray/well position for life and two trays never share a position (see
  // waitingCells.computeTrayEvictionDates).
  const trayEvictionDates = useMemo(
    () => computeTrayEvictionDates(allTrayCells, trayFoundingDates),
    [allTrayCells, trayFoundingDates],
  );
  const waitingGrouped = useMemo(
    () =>
      groupWaitingCellsByInstrumentAndDay(
        [...(waitingCellsQuery.data ?? []), ...(terminalCellsQuery.data ?? [])],
        win.days,
        vacatedTrayIds,
        trayFoundingDates,
        trayEvictionDates,
      ),
    [waitingCellsQuery.data, terminalCellsQuery.data, win.days, vacatedTrayIds, trayFoundingDates, trayEvictionDates],
  );
  // Wells permanently dead from a stopped cell, per (instrument, day). Day-aware because a
  // later tray legitimately reuses the same well letter once the stopped cell's own tray has
  // left the instrument (see computeBlockedWellsByInstrumentAndDay) - so the block can't be a
  // single all-days set per instrument.
  const blockedGrouped = useMemo(
    () => computeBlockedWellsByInstrumentAndDay(allTrayCells, win.days, trayFoundingDates),
    [allTrayCells, win.days, trayFoundingDates],
  );
  // Physical trays whose disposal will strand still-unused cell capacity, keyed to the
  // tray's last-chance day - the last day it's still present and still has salvageable
  // capacity (bounded by its cells' 108h reuse cutoffs and by a successor tray evicting it) -
  // so the warning sits by the Confirm loaded control on the day the user can still act, not
  // on a freshly-loaded run days before the cells actually expire (see
  // computeTrayDisposalWarnings).
  const disposalGrouped = useMemo(
    () => computeTrayDisposalWarnings(allTrayCells, win.days, trayEvictionDates),
    [allTrayCells, win.days, trayEvictionDates],
  );
  // `cycles` is fetched a few days wider than the visible window (see lookbackDateFrom
  // above), purely so carry-over locks can see runs that started just before it. Anything
  // deriving from the actually-visible week (bulk clear, etc.) must filter back down.
  const visibleCycles = useMemo(() => cycles.filter((c) => win.days.includes(c.run_date)), [cycles, win.days]);

  // Intersect the selection with the currently selectable (empty, non-weekend) cells to
  // get the concrete auto-fill payload.
  const selectedCells = useMemo(() => {
    const out: GridCellRef[] = [];
    instrumentSerials.forEach((serial, r) => {
      win.days.forEach((date, c) => {
        if (!selection.isSelected(r, c)) return;
        if (isWeekendUTC(parseDateOnly(date))) return;
        const byDate = grouped.get(serial);
        const cycle = byDate?.get(date);
        const carryOverLock = cycle || !byDate ? undefined : findCarryOverLock(byDate, date);
        if (!isCellOpen(cycle, carryOverLock)) return;
        out.push({ instrument_serial: serial, run_date: date });
      });
    });
    return out;
  }, [instrumentSerials, win.days, grouped, selection]);

  // Every placed, unlocked (still "planned") sample anywhere in the currently-viewed
  // week, for the "Clear schedule" confirm-and-wipe action. Locked (confirmed-loaded)
  // cycles are excluded since the backend rejects removing their stages. The stage-level
  // filter matters too: a still-"planned" cycle can contain a cancelled marker (from a
  // stopped cell - permanent, the backend refuses to remove it) or a failed/aborted/
  // completed/started stage (a real recorded QC outcome, predating any Confirm-loaded
  // click) - neither is a "planned sample" to clear.
  const weekPlannedStages = useMemo(
    () =>
      visibleCycles
        .filter((cycle) => cycle.status === "planned")
        .flatMap((cycle) => cycle.stages)
        .filter((stage) => stage.cell_use_status === "planned"),
    [visibleCycles],
  );

  // Every eligible (unlocked, non-cancelled) sample anywhere in the (instrument row, day
  // column) rectangle bounded by [r0,r1] x [c0,c1] - the shared basis for both the
  // ctrl/cmd+shift-click rectangle extend and the ctrl/cmd-drag rectangle select below.
  function stagesInRect(r0: number, r1: number, c0: number, c1: number): StageOut[] {
    const stages: StageOut[] = [];
    for (let r = r0; r <= r1; r++) {
      const serial = instrumentSerials[r];
      if (!serial) continue;
      const byDate = grouped.get(serial);
      if (!byDate) continue;
      for (let c = c0; c <= c1; c++) {
        const date = win.days[c];
        if (!date) continue;
        const cycle = byDate.get(date);
        if (!cycle || cycle.status !== "planned") continue;
        for (const s of cycle.stages) {
          if (s.cell_use_status !== "cancelled") stages.push(s);
        }
      }
    }
    return stages;
  }

  // Ctrl/cmd+shift-click on a filled slot: extend slotSelection to every eligible sample
  // in the rectangle between the last-toggled slot (slotSelection.anchor) and this one -
  // same grid coordinates useGridSelection uses for empty-cell rectangle selection. Falls
  // back to a plain toggle if there's no anchor yet (e.g. the very first click was
  // already a ctrl+shift-click).
  function onExtendSlotSelect(stage: StageOut, coord: { r: number; c: number }) {
    const anchor = slotSelection.anchor;
    if (!anchor) {
      slotSelection.toggle(stage, coord);
      return;
    }
    slotSelection.replaceWith(
      stagesInRect(Math.min(anchor.r, coord.r), Math.max(anchor.r, coord.r), Math.min(anchor.c, coord.c), Math.max(anchor.c, coord.c)),
    );
  }

  // Ctrl/cmd-mousedown on a filled slot: draws a live rectangle selection as the mouse
  // moves, mirroring onExtendSlotSelect but continuously instead of via a second click.
  // SchedulerSlot opts this pointer interaction out of dnd-kit's own drag entirely (see
  // its onPointerDown), so this is the only thing that runs for a ctrl-held drag. Plain
  // window listeners (not React state) drive it, the same pattern the outside-click
  // clear effect above uses, since every intermediate frame just needs to read the
  // cursor position - not trigger a page-level re-render on its own.
  function onDragSelectStart(_stage: StageOut, coord: { r: number; c: number }) {
    const state: { anchor: { r: number; c: number }; lastKey: string | null } = { anchor: coord, lastKey: null };
    function handlePointerMove(e: globalThis.PointerEvent) {
      const td = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        "td[data-row]",
      );
      if (!td) return;
      const r = Number(td.dataset.row);
      const c = Number(td.dataset.col);
      const r0 = Math.min(state.anchor.r, r);
      const r1 = Math.max(state.anchor.r, r);
      const c0 = Math.min(state.anchor.c, c);
      const c1 = Math.max(state.anchor.c, c);
      const key = `${r0}-${r1}-${c0}-${c1}`;
      if (key === state.lastKey) return;
      state.lastKey = key;
      slotSelection.replaceWith(stagesInRect(r0, r1, c0, c1));
    }
    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  // Clear both selections whenever the window pages.
  useEffect(() => {
    selection.clear();
    slotSelection.clear();
    setRunDesignNote(null);
    setRemoveSlotsError(null);
    setClearConfirmOpen(false);
  }, [win.from, selection.clear, slotSelection.clear]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeSlotsMutation = useMutation({
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
  const dragRemoveMutation = useMutation({
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
  const swapMutation = useMutation({
    mutationFn: ({ a, b }: { a: number; b: number }) => cellUsesApi.swap(a, b),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setRemoveSlotsError(null);
    },
    onError: (err) => {
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to swap samples.");
    },
  });

  const dnd = useSchedulerDnd(
    (cellUseId) => dragRemoveMutation.mutate(cellUseId),
    (a, b) => swapMutation.mutate({ a, b }),
  );
  // Suppressed during any drag (backlog-sample or filled-slot move) so the hover/pin
  // highlight never fights the drag/drop visuals - see useCellLinkHighlight.tsx.
  const cellLink = useCellLinkHighlight(dnd.activeSample !== null);

  // Bulk-remove every planned (unlocked) sample in the currently-viewed week - gated
  // behind the confirm modal below since it's destructive and can span every instrument.
  const clearScheduleMutation = useMutation({
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

  function onRequestClearSchedule() {
    setRunDesignNote(null);
    clearScheduleMutation.reset();
    setClearConfirmOpen(true);
  }

  // Clicking anywhere outside the weekly schedule grid deselects both selections - lets
  // users click away (blank page, etc.) to dismiss a selection without hunting for the
  // "Clear" button. Skipped while a modal/popover is open: those render as siblings of
  // the grid (not inside gridAreaRef), so their own clicks would otherwise count as
  // "outside" and clear the selection out from under an in-progress action inside it
  // (e.g. a QC action in SlotDetailPopover). The
  // accordions (Run Design's Auto-Schedule button in particular) are excluded from
  // "outside" for the same reason: mousedown fires before click, so without this a
  // click on Auto-Schedule cleared the selection an instant before onAutoSchedule read
  // it, making the click silently schedule zero cells.
  useEffect(() => {
    if (!selection.hasSelection && !slotSelection.hasSelection) return;
    if (detail || ghostDetail || printSheetOpen || clearConfirmOpen || dnd.pendingPlacement) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (gridAreaRef.current?.contains(target)) return;
      if (accordionsRef.current?.contains(target)) return;
      selection.clear();
      slotSelection.clear();
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [
    selection.hasSelection,
    slotSelection.hasSelection,
    selection.clear,
    slotSelection.clear,
    detail,
    ghostDetail,
    printSheetOpen,
    clearConfirmOpen,
    dnd.pendingPlacement,
  ]);

  // Delete/Backspace removes the selected samples from the schedule, as long as focus
  // isn't in a text field (so it doesn't hijack editing elsewhere on the page).
  useEffect(() => {
    if (!slotSelection.hasSelection) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      removeSlotsMutation.mutate();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slotSelection.hasSelection, removeSlotsMutation]);

  const autoFillMutation = useMutation({
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

  function onAutoSchedule() {
    setRunDesignNote(null);
    autoFillMutation.mutate();
  }

  function handleOpenDetail(stage: StageOut, cycle: CycleOut) {
    setDetail({ stage, cycle });
  }

  const rangeLabel = `${formatShortDateUTC(parseDateOnly(win.dateFrom))} – ${formatShortDateUTC(
    parseDateOnly(win.dateTo),
  )}`;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.pager}>
          <Button size="sm" variant="ghost" onClick={win.prev}>
            ‹ Prev
          </Button>
          <span className={styles.range}>{rangeLabel}</span>
          <Button size="sm" variant="ghost" onClick={win.next}>
            Next ›
          </Button>
          <Button size="sm" variant="ghost" onClick={win.goToday}>
            Today
          </Button>
          <input
            className={styles.jumpDate}
            type="date"
            value={win.from}
            onChange={(e) => e.target.value && win.goToDate(e.target.value)}
            aria-label="Jump to date"
            title="Jump to the week containing this date"
          />
          <Button size="sm" variant="ghost" onClick={() => setPrintSheetOpen(true)}>
            Print Batch Sheet
          </Button>
        </div>
        <div className={styles.spacer} />
        {selectedCells.length > 0 && (
          <div className={styles.selectionInfo}>
            <span>{selectedCells.length} cell(s) selected</span>
            <Button size="sm" variant="ghost" onClick={selection.clear}>
              Clear
            </Button>
          </div>
        )}
        {slotSelection.hasSelection && (
          <div className={styles.selectionInfo}>
            <span>{slotSelection.selectedStages.length} sample(s) selected</span>
            <Button size="sm" variant="ghost" onClick={slotSelection.clear} disabled={removeSlotsMutation.isPending}>
              Clear
            </Button>
            <Button size="sm" variant="primary" onClick={() => removeSlotsMutation.mutate()} disabled={removeSlotsMutation.isPending}>
              {removeSlotsMutation.isPending ? "Removing…" : "Remove from schedule (Del)"}
            </Button>
          </div>
        )}
      </div>
      {removeSlotsError && (
        <Note tone="bad" icon="!">
          {removeSlotsError}
        </Note>
      )}

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
      >
        <CellLinkContext.Provider value={cellLink}>
          <div className={styles.accordions} ref={accordionsRef}>
            <RunDesignAccordion
              runDesign={runDesign}
              onChange={setRunDesign}
              selectedCount={selectedCells.length}
              onAutoSchedule={onAutoSchedule}
              autoFilling={autoFillMutation.isPending}
              weekPlannedCount={weekPlannedStages.length}
              onRequestClearSchedule={onRequestClearSchedule}
              note={runDesignNote}
            />
            <BacklogAccordion />
          </div>

          <div className={styles.gridArea} ref={gridAreaRef}>
            <SectionHeading title="Weekly schedule" legend={<UseLegend />} />

            {instrumentsQuery.isLoading && <div className={styles.status}>Loading instruments…</div>}
            {instrumentsQuery.isError && (
              <Note tone="bad" icon="!">
                {instrumentsQuery.error instanceof ApiError ? instrumentsQuery.error.message : "Failed to load instruments."}
              </Note>
            )}
            {!instrumentsQuery.isLoading && !instrumentsQuery.isError && instrumentSerials.length === 0 && (
              <Note tone="info" icon="i">
                No active instruments configured.
              </Note>
            )}
            {cyclesQuery.isError && (
              <Note tone="bad" icon="!">
                {cyclesQuery.error instanceof ApiError ? cyclesQuery.error.message : "Failed to load schedule."}
              </Note>
            )}

            {instrumentSerials.length > 0 && (
              <SchedulerGrid
                instrumentSerials={instrumentSerials}
                days={win.days}
                cycles={cycles}
                selection={selection}
                placingSlotKey={dnd.placingSlotKey}
                onOpenDetail={handleOpenDetail}
                slotSelection={slotSelection}
                onExtendSelect={onExtendSlotSelect}
                onDragSelectStart={onDragSelectStart}
                waitingGrouped={waitingGrouped}
                blockedGrouped={blockedGrouped}
                disposalGrouped={disposalGrouped}
                onOpenGhost={setGhostDetail}
              />
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {dnd.activeSample ? <div className={styles.dragChip}>{dnd.activeSample.external_id || "sample"}</div> : null}
          </DragOverlay>
        </CellLinkContext.Provider>
      </DndContext>

      {dnd.pendingPlacement && (
        <CellChoicePicker
          pending={dnd.pendingPlacement}
          runDesign={runDesign}
          existingRun={grouped.get(dnd.pendingPlacement.instrument_serial)?.get(dnd.pendingPlacement.run_date)}
          onClose={() => dnd.setPendingPlacement(null)}
          onPlaced={() => dnd.setPendingPlacement(null)}
          setPlacingSlotKey={dnd.setPlacingSlotKey}
        />
      )}

      {clearConfirmOpen && (
        <ClearScheduleModal
          weekLabel={rangeLabel}
          count={weekPlannedStages.length}
          pending={clearScheduleMutation.isPending}
          error={clearScheduleMutation.error}
          onCancel={() => setClearConfirmOpen(false)}
          onConfirm={() => clearScheduleMutation.mutate()}
        />
      )}

      {ghostDetail && <WaitingCellPopover ghost={ghostDetail} onClose={() => setGhostDetail(null)} />}

      {printSheetOpen && (
        <PrintBatchSheetModal instruments={instrumentsQuery.data ?? []} onClose={() => setPrintSheetOpen(false)} />
      )}

      {detail && <SlotDetailPopover stage={detail.stage} cycle={detail.cycle} onClose={() => setDetail(null)} />}
    </div>
  );
}

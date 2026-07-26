import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { scheduleExportUrl } from "@/api/scheduleExport";
import { CellInfoPopover } from "@/components/scheduler/CellInfoPopover";
import { LoadTimePicker } from "@/components/scheduler/LoadTimePicker";
import {
  allStages,
  groupCyclesByInstrumentAndDay,
  LOCK_LOOKBACK_DAYS,
  resolveCell,
} from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { slotKey } from "@/components/scheduler/gridKeys";
import { computeInstrumentTrayMaps } from "@/components/scheduler/instrumentTrayMaps";
import { SchedulerGrid } from "@/components/scheduler/SchedulerGrid";
import { SlotDetailPopover } from "@/components/scheduler/SlotDetailPopover";
import { CellLinkContext, useCellLinkHighlight } from "@/components/scheduler/useCellLinkHighlight";
import { useGridSelection } from "@/components/scheduler/useGridSelection";
import { useSchedulerDnd } from "@/components/scheduler/useSchedulerDnd";
import { useSlotSelection } from "@/components/scheduler/useSlotSelection";
import {
  computeBlockedWellsByInstrumentAndDay,
  computeTrayEvictionDates,
  computeTrayFoundingDates,
  computeVacatedTrayIds,
  groupWaitingCellsByInstrumentAndDay,
} from "@/components/scheduler/waitingCells";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { RunOut, SlotIndex, StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";
import { addDaysUTC, formatShortDateUTC, isWeekendUTC, parseDateOnly, todayIsoUTC, toIsoDateUTC } from "@/utils/calendarDates";

import { AutoscheduleDrawer } from "./AutoscheduleDrawer";
import { BacklogAccordion } from "./BacklogAccordion";
import { ClearScheduleModal } from "./ClearScheduleModal";
import { PrintBatchSheetModal } from "./PrintBatchSheetModal";
import styles from "./SchedulePage.module.css";
import { useScheduleActions } from "./useScheduleActions";
import { useSchedulerWindow } from "./useSchedulerWindow";

const DEFAULT_RUN_DESIGN: RunDesignState = {
  max_uses: 3,
  run_time_hours: 24,
  objective: "fewest",
  cells_per_day: 8,
  load_hour: 12,
};

interface DetailTarget {
  stage: StageOut;
  run: RunOut;
}

export function SchedulePage() {
  const win = useSchedulerWindow();
  const selection = useGridSelection();
  const slotSelection = useSlotSelection();

  const [runDesign, setRunDesign] = useState<RunDesignState>(DEFAULT_RUN_DESIGN);
  const [autoscheduleOpen, setAutoscheduleOpen] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [printSheetOpen, setPrintSheetOpen] = useState(false);
  // The placement whose physical-cell info popover is open (the card's "ticket stub" click).
  const [cellInfo, setCellInfo] = useState<DetailTarget | null>(null);
  // A drop that would create a brand-new run, held while the load-time wheel is shown so the
  // user sets when that run loads/starts before it's committed (see LoadTimePicker).
  const [pendingLoadTime, setPendingLoadTime] = useState<{
    sample_id: number;
    instrument_serial: string;
    load_date: string;
    slot_index: SlotIndex;
  } | null>(null);
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const stickyHeadRef = useRef<HTMLDivElement>(null);

  // Expose the pinned head's live height as a CSS var so the grid's day-header row can pin
  // itself directly beneath it (see SchedulerGrid.module.css .dayTh/.corner). Mirrors how
  // AppShell publishes --topbar-h; the head grows/shrinks as the Backlog tray expands or
  // wraps, so it's measured rather than hard-coded.
  useLayoutEffect(() => {
    const el = stickyHeadRef.current;
    if (!el) return;
    const setHeight = () => document.documentElement.style.setProperty("--sched-head-h", `${el.offsetHeight}px`);
    setHeight();
    const observer = new ResizeObserver(setHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  // Fetch a few days further back than the visible window so a run loaded just before it
  // (still occupying its instrument - a reuse Plate 2 acquiring, or a lock spanning) is
  // known about for the continuation marker, even though its own load day isn't a column.
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
  // Per-instrument display name + maintenance-down date for the grid (label + greyed down
  // days), keyed by serial so the grid keeps using the serial as its row identity.
  const instrumentMeta = useMemo(
    () =>
      new Map(
        (instrumentsQuery.data ?? []).map((i) => [i.serial_number, { name: i.name, downFrom: i.down_from }]),
      ),
    [instrumentsQuery.data],
  );
  const runs = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const grouped = useMemo(() => groupCyclesByInstrumentAndDay(runs), [runs]);
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
  // The physical-tray map for each instrument's left-column header: the tray resident at the
  // start of the viewed week per carousel position, plus any successor trays loaded later that
  // week (see instrumentTrayMaps.ts). Reuses the same tray founding/eviction/vacated maps the
  // grid ghosts do, so tray residency agrees exactly.
  const trayMaps = useMemo(
    () => computeInstrumentTrayMaps(allTrayCells, win.days, trayFoundingDates, trayEvictionDates, vacatedTrayIds),
    [allTrayCells, win.days, trayFoundingDates, trayEvictionDates, vacatedTrayIds],
  );
  // `runs` is fetched a few days wider than the visible window (see lookbackDateFrom
  // above), purely so continuation markers can see runs loaded just before it. Anything
  // deriving from the actually-visible week (bulk clear, etc.) must filter back down.
  const visibleRuns = useMemo(() => runs.filter((r) => win.days.includes(r.load_date)), [runs, win.days]);

  // Intersect the selection with the currently selectable (empty, non-weekend) cells to
  // get the concrete auto-fill payload.
  const selectedCells = useMemo(() => {
    const out: GridCellRef[] = [];
    instrumentSerials.forEach((serial, r) => {
      win.days.forEach((date, c) => {
        if (!selection.isSelected(r, c)) return;
        if (isWeekendUTC(parseDateOnly(date))) return;
        if (!resolveCell(grouped.get(serial), date).open) return;
        out.push({ instrument_serial: serial, load_date: date });
      });
    });
    return out;
  }, [instrumentSerials, win.days, grouped, selection]);

  // Every placed, unlocked (still "planned") sample anywhere in the currently-viewed
  // week, for the "Clear schedule" confirm-and-wipe action. Locked (confirmed-loaded)
  // runs are excluded since the backend rejects removing their stages. The stage-level
  // filter matters too: a still-"planned" run can contain a cancelled marker (from a
  // stopped cell - permanent, the backend refuses to remove it) or a failed/aborted/
  // completed/started stage (a real recorded QC outcome, predating any Confirm-loaded
  // click) - neither is a "planned sample" to clear.
  const weekPlannedStages = useMemo(
    () =>
      visibleRuns
        .filter((run) => run.status === "planned")
        .flatMap((run) => allStages(run))
        .filter((stage) => stage.cell_use_status === "planned"),
    [visibleRuns],
  );

  // Every eligible (unlocked, non-cancelled) sample anywhere in the (instrument row, day
  // column) rectangle bounded by [r0,r1] x [c0,c1] - the shared basis for both the
  // ctrl/cmd+shift-click rectangle extend and the ctrl/cmd-drag rectangle select below.
  const stagesInRect = useCallback(
    (r0: number, r1: number, c0: number, c1: number): StageOut[] => {
      const stages: StageOut[] = [];
      for (let r = r0; r <= r1; r++) {
        const serial = instrumentSerials[r];
        if (!serial) continue;
        const byDate = grouped.get(serial);
        if (!byDate) continue;
        for (let c = c0; c <= c1; c++) {
          const date = win.days[c];
          if (!date) continue;
          const run = byDate.get(date);
          if (!run || run.status !== "planned") continue;
          for (const s of allStages(run)) {
            if (s.cell_use_status !== "cancelled") stages.push(s);
          }
        }
      }
      return stages;
    },
    [instrumentSerials, grouped, win.days],
  );

  // Ctrl/cmd+shift-click on a filled slot: extend slotSelection to every eligible sample
  // in the rectangle between the last-toggled slot (slotSelection.anchor) and this one -
  // same grid coordinates useGridSelection uses for empty-cell rectangle selection. Falls
  // back to a plain toggle if there's no anchor yet (e.g. the very first click was
  // already a ctrl+shift-click).
  const onExtendSlotSelect = useCallback(
    (stage: StageOut, coord: { r: number; c: number }) => {
      const anchor = slotSelection.anchor;
      if (!anchor) {
        slotSelection.toggle(stage, coord);
        return;
      }
      slotSelection.replaceWith(
        stagesInRect(Math.min(anchor.r, coord.r), Math.max(anchor.r, coord.r), Math.min(anchor.c, coord.c), Math.max(anchor.c, coord.c)),
      );
    },
    [slotSelection, stagesInRect],
  );

  // Ctrl/cmd-mousedown on a filled slot: draws a live rectangle selection as the mouse
  // moves, mirroring onExtendSlotSelect but continuously instead of via a second click.
  // SchedulerSlot opts this pointer interaction out of dnd-kit's own drag entirely (see
  // its onPointerDown), so this is the only thing that runs for a ctrl-held drag. Plain
  // window listeners (not React state) drive it, the same pattern the outside-click
  // clear effect above uses, since every intermediate frame just needs to read the
  // cursor position - not trigger a page-level re-render on its own.
  const onDragSelectStart = useCallback(
    (_stage: StageOut, coord: { r: number; c: number }) => {
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
    },
    [slotSelection, stagesInRect],
  );

  const actions = useScheduleActions({ selection, slotSelection, selectedCells, runDesign, weekPlannedStages });

  // Clear both selections and any action feedback whenever the window pages.
  useEffect(() => {
    selection.clear();
    slotSelection.clear();
    actions.resetFeedback();
  }, [win.from, selection.clear, slotSelection.clear, actions.resetFeedback]); // eslint-disable-line react-hooks/exhaustive-deps

  const dnd = useSchedulerDnd(
    (cellUseId) => actions.dragRemove.mutate(cellUseId),
    (a, b) => actions.swap.mutate({ a, b }),
    (sampleId, instrumentSerial, loadDate, slotIndex) => {
      // Dropping the first sample onto an empty instrument+day creates a brand-new run - ask
      // for its load time (the wheel) before committing, so the user sets when it loads and
      // starts sequencing. A drop onto a day that already has a run places straight away at
      // that run's already-fixed time.
      if (!grouped.get(instrumentSerial)?.get(loadDate)) {
        setPendingLoadTime({ sample_id: sampleId, instrument_serial: instrumentSerial, load_date: loadDate, slot_index: slotIndex });
        return;
      }
      // A plain auto-place has no picker to show, so drive the "placing…" shimmer directly
      // (the CellChoicePicker path does the same via setPlacingSlotKey) - otherwise the
      // dropped slot sits blank until the backend derives the cell and the grid refetches.
      dnd.setPlacingSlotKey(slotKey(instrumentSerial, loadDate, slotIndex));
      actions.autoPlace.mutate(
        {
          sample_id: sampleId,
          instrument_serial: instrumentSerial,
          load_date: loadDate,
          slot_index: slotIndex,
        },
        { onSettled: () => dnd.setPlacingSlotKey(null) },
      );
    },
    (cellUseId, instrumentSerial, loadDate, slotIndex) => {
      // A drag-move re-plans a placement: no picker, the backend keeps or derives the cell.
      dnd.setPlacingSlotKey(slotKey(instrumentSerial, loadDate, slotIndex));
      actions.move.mutate(
        { cell_use_id: cellUseId, instrument_serial: instrumentSerial, load_date: loadDate, slot_index: slotIndex },
        { onSettled: () => dnd.setPlacingSlotKey(null) },
      );
    },
  );
  // Suppressed during any drag (backlog-sample or filled-slot move) so the hover/pin
  // highlight never fights the drag/drop visuals - see useCellLinkHighlight.tsx.
  const cellLink = useCellLinkHighlight(dnd.activeSample !== null);

  // Clicking anywhere outside the weekly schedule grid deselects both selections - lets
  // users click away (blank page, etc.) to dismiss a selection without hunting for the
  // "Clear" button. Skipped while a modal/popover is open: those render as siblings of
  // the grid (not inside gridAreaRef), so their own clicks would otherwise count as
  // "outside" and clear the selection out from under an in-progress action inside it
  // (e.g. a QC action in SlotDetailPopover). The Autoschedule drawer (whose Auto-Schedule
  // button acts on the current selection) is excluded for the same reason: mousedown fires
  // before click, so without this a click on Auto-Schedule cleared the selection an instant
  // before onAutoSchedule read it, making the click silently schedule zero cells - so the
  // whole effect is skipped while the drawer is open. The pinned sticky head (the date
  // toolbar plus its own Clear/Remove buttons, the ✨ Autoschedule button and the pinned
  // Backlog tray) is excluded on the same grounds - those controls act on the current
  // selection, so their mousedown must not wipe it out from under their own click.
  useEffect(() => {
    if (!selection.hasSelection && !slotSelection.hasSelection) return;
    if (detail || cellInfo || printSheetOpen || actions.clearConfirmOpen || dnd.pendingPlacement || autoscheduleOpen) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (gridAreaRef.current?.contains(target)) return;
      if (stickyHeadRef.current?.contains(target)) return;
      selection.clear();
      slotSelection.clear();
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
    // selection/slotSelection are stable (memoized in their hooks), so depending on the
    // whole objects re-subscribes only on a real selection change, same as before.
  }, [selection, slotSelection, detail, cellInfo, printSheetOpen, actions.clearConfirmOpen, dnd.pendingPlacement, autoscheduleOpen]);

  // Delete/Backspace removes the selected samples from the schedule, as long as focus
  // isn't in a text field (so it doesn't hijack editing elsewhere on the page).
  useEffect(() => {
    if (!slotSelection.hasSelection) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      actions.removeSlots.mutate();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slotSelection.hasSelection, actions.removeSlots]);

  const handleOpenDetail = useCallback((stage: StageOut, run: RunOut) => {
    setDetail({ stage, run });
  }, []);

  const handleOpenCell = useCallback((stage: StageOut, run: RunOut) => setCellInfo({ stage, run }), []);

  const handleExportSchedule = useCallback(() => {
    const a = document.createElement("a");
    a.href = scheduleExportUrl({ date_from: win.dateFrom, date_to: win.dateTo });
    a.download = ""; // let the server's Content-Disposition name the file
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [win.dateFrom, win.dateTo]);

  const rangeLabel = `${formatShortDateUTC(parseDateOnly(win.dateFrom))} – ${formatShortDateUTC(
    parseDateOnly(win.dateTo),
  )}`;

  // How far through the displayed week "today" is, for the Weekly-schedule heading's
  // loading-bar rule. 0 when the whole week is still ahead, 1 when it's fully in the
  // past, otherwise the current weekday's proportional position (its column's centre)
  // so the brand dot lands on today. Weekend "today" (Sat/Sun) reads as a finished week.
  const weekProgress = useMemo(() => {
    const today = todayIsoUTC();
    if (win.days.length === 0) return 0;
    if (today < win.days[0]) return 0;
    if (today > win.days[win.days.length - 1]) return 1;
    const idx = win.days.indexOf(today);
    if (idx === -1) return 1; // a weekday not shown falls past the visible columns
    return (idx + 0.5) / win.days.length;
  }, [win.days]);

  return (
    <div className={styles.page}>
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
      >
        <CellLinkContext.Provider value={cellLink}>
          {/* Pinned head: the date toolbar plus the Backlog tray stay stuck below the nav
              so a backlog card can be dragged straight onto any slot without scrolling the
              tray back into view first. The tray's own card list scrolls internally so the
              pinned region never swallows the grid (see BacklogAccordion). */}
          <div className={styles.stickyHead} ref={stickyHeadRef}>
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExportSchedule}
                  title="Download the visible week as a sequencing-tracker CSV to paste into the Google Sheet"
                >
                  Export schedule
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
                  <Button size="sm" variant="ghost" onClick={slotSelection.clear} disabled={actions.removeSlots.isPending}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => actions.removeSlots.mutate()}
                    disabled={actions.removeSlots.isPending}
                  >
                    {actions.removeSlots.isPending ? "Removing…" : "Remove from schedule (Del)"}
                  </Button>
                </div>
              )}
            </div>
            <BacklogAccordion onOpenAutoschedule={() => setAutoscheduleOpen(true)} />
          </div>

          {actions.removeSlotsError && (
            <Note tone="bad" icon="!">
              {actions.removeSlotsError}
            </Note>
          )}

          <div className={styles.gridArea} ref={gridAreaRef}>
            <SectionHeading title="Weekly schedule" legend={<UseLegend />} progress={weekProgress} />

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
                instrumentMeta={instrumentMeta}
                days={win.days}
                grouped={grouped}
                selection={selection}
                placingSlotKey={dnd.placingSlotKey}
                onOpenDetail={handleOpenDetail}
                onOpenCell={handleOpenCell}
                slotSelection={slotSelection}
                onExtendSelect={onExtendSlotSelect}
                onDragSelectStart={onDragSelectStart}
                waitingGrouped={waitingGrouped}
                blockedGrouped={blockedGrouped}
                trayMaps={trayMaps}
              />
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {dnd.activeSample ? <div className={styles.dragChip}>{dnd.activeSample.external_id || "sample"}</div> : null}
          </DragOverlay>
        </CellLinkContext.Provider>
      </DndContext>

      {pendingLoadTime && (
        <LoadTimePicker
          value={runDesign.load_hour}
          subtitle={`New run — pick when it loads on ${formatShortDateUTC(parseDateOnly(pendingLoadTime.load_date))} and starts sequencing.`}
          onCancel={() => setPendingLoadTime(null)}
          onPick={(hour) => {
            const p = pendingLoadTime;
            setPendingLoadTime(null);
            setRunDesign((rd) => ({ ...rd, load_hour: hour })); // remember for the next drop / auto-fill
            dnd.setPlacingSlotKey(slotKey(p.instrument_serial, p.load_date, p.slot_index));
            actions.autoPlace.mutate(
              {
                sample_id: p.sample_id,
                instrument_serial: p.instrument_serial,
                load_date: p.load_date,
                slot_index: p.slot_index,
                start_hour: hour,
                start_minute: 0,
              },
              { onSettled: () => dnd.setPlacingSlotKey(null) },
            );
          }}
        />
      )}

      {actions.clearConfirmOpen && (
        <ClearScheduleModal
          weekLabel={rangeLabel}
          count={weekPlannedStages.length}
          pending={actions.clearSchedule.isPending}
          error={actions.clearSchedule.error}
          onCancel={() => actions.setClearConfirmOpen(false)}
          onConfirm={() => actions.clearSchedule.mutate()}
        />
      )}

      {printSheetOpen && (
        <PrintBatchSheetModal instruments={instrumentsQuery.data ?? []} onClose={() => setPrintSheetOpen(false)} />
      )}

      {autoscheduleOpen && (
        <AutoscheduleDrawer
          runDesign={runDesign}
          onChange={setRunDesign}
          selectedCount={selectedCells.length}
          onAutoSchedule={actions.onAutoSchedule}
          autoFilling={actions.autoFill.isPending}
          weekPlannedCount={weekPlannedStages.length}
          onRequestClearSchedule={actions.onRequestClearSchedule}
          note={actions.runDesignNote}
          onClose={() => setAutoscheduleOpen(false)}
        />
      )}

      {detail && <SlotDetailPopover stage={detail.stage} run={detail.run} onClose={() => setDetail(null)} />}
      {cellInfo && <CellInfoPopover stage={cellInfo.stage} run={cellInfo.run} onClose={() => setCellInfo(null)} />}
    </div>
  );
}

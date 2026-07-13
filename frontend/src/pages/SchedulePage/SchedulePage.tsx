import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { cellUsesApi } from "@/api/cellUses";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { schedulerApi } from "@/api/schedulerGrid";
import { CellChoicePicker } from "@/components/scheduler/CellChoicePicker";
import { groupCyclesByInstrumentAndDay } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { SchedulerGrid } from "@/components/scheduler/SchedulerGrid";
import { SlotDetailPopover } from "@/components/scheduler/SlotDetailPopover";
import { useGridSelection } from "@/components/scheduler/useGridSelection";
import { useSchedulerDnd } from "@/components/scheduler/useSchedulerDnd";
import { useSlotSelection } from "@/components/scheduler/useSlotSelection";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Button } from "@/components/ui/Button";
import type { NoteTone } from "@/components/ui/Note";
import { Note } from "@/components/ui/Note";
import type { StageOut } from "@/types/schedule";
import type { GridCellRef, RunDesignState } from "@/types/schedulerGrid";
import { formatShortDateUTC, isWeekendUTC, parseDateOnly } from "@/utils/calendarDates";

import { BacklogAccordion } from "./BacklogAccordion";
import { RunDesignAccordion } from "./RunDesignAccordion";
import styles from "./SchedulePage.module.css";
import { useSchedulerWindow } from "./useSchedulerWindow";

const DEFAULT_RUN_DESIGN: RunDesignState = { max_uses: 3, run_time_hours: 24, objective: "fewest" };

interface DetailTarget {
  stage: StageOut;
  locked: boolean;
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
  const dnd = useSchedulerDnd();

  const [runDesign, setRunDesign] = useState<RunDesignState>(DEFAULT_RUN_DESIGN);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [autoFillNote, setAutoFillNote] = useState<AccordionNote | null>(null);
  const [removeSlotsError, setRemoveSlotsError] = useState<string | null>(null);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const cyclesQuery = useQuery({
    queryKey: ["cycles", { date_from: win.dateFrom, date_to: win.dateTo }],
    queryFn: () => cyclesApi.list({ date_from: win.dateFrom, date_to: win.dateTo }),
    placeholderData: (prev) => prev,
  });

  const instrumentSerials = useMemo(
    () => (instrumentsQuery.data ?? []).map((i) => i.serial_number),
    [instrumentsQuery.data],
  );
  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const grouped = useMemo(() => groupCyclesByInstrumentAndDay(cycles), [cycles]);

  // Intersect the selection with the currently selectable (empty, non-weekend) cells to
  // get the concrete auto-fill payload.
  const selectedCells = useMemo(() => {
    const out: GridCellRef[] = [];
    instrumentSerials.forEach((serial, r) => {
      win.days.forEach((date, c) => {
        if (!selection.isSelected(r, c)) return;
        if (isWeekendUTC(parseDateOnly(date))) return;
        if (grouped.get(serial)?.has(date)) return;
        out.push({ instrument_serial: serial, run_date: date });
      });
    });
    return out;
  }, [instrumentSerials, win.days, grouped, selection]);

  // Clear both selections whenever the window pages.
  useEffect(() => {
    selection.clear();
    slotSelection.clear();
    setAutoFillNote(null);
    setRemoveSlotsError(null);
  }, [win.from, selection.clear, slotSelection.clear]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeSlotsMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(slotSelection.selectedStages.map((stage) => cellUsesApi.remove(stage.cell_use_id)));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      slotSelection.clear();
      setRemoveSlotsError(null);
    },
    onError: (err) => {
      setRemoveSlotsError(err instanceof ApiError ? err.message : "Failed to remove selected samples.");
    },
  });

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
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      void queryClient.invalidateQueries({ queryKey: ["cells"] });
      selection.clear();
      const parts = [`${res.placed_sample_ids.length} placed`];
      if (res.unplaced_sample_ids.length > 0) parts.push(`${res.unplaced_sample_ids.length} unplaced`);
      if (res.skipped_cells.length > 0) parts.push(`${res.skipped_cells.length} cell(s) skipped`);
      if (res.window_flags.length > 0) parts.push(`${res.window_flags.length} window flag(s)`);
      const clean = res.unplaced_sample_ids.length === 0 && res.window_flags.length === 0;
      setAutoFillNote({
        tone: clean ? "good" : "warn",
        icon: clean ? "✓" : "!",
        text: parts.join(" · "),
      });
    },
    onError: (err) => {
      setAutoFillNote({
        tone: "bad",
        icon: "!",
        text: err instanceof ApiError ? err.message : "Auto-schedule failed.",
      });
    },
  });

  function onAutoSchedule() {
    setAutoFillNote(null);
    autoFillMutation.mutate();
  }

  function handleOpenDetail(stage: StageOut, locked: boolean) {
    setDetail({ stage, locked });
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
        <div className={styles.accordions}>
          <RunDesignAccordion
            runDesign={runDesign}
            onChange={setRunDesign}
            selectedCount={selectedCells.length}
            onAutoSchedule={onAutoSchedule}
            autoFilling={autoFillMutation.isPending}
            note={autoFillNote}
          />
          <BacklogAccordion />
        </div>

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
          />
        )}

        <DragOverlay dropAnimation={null}>
          {dnd.activeSample ? <div className={styles.dragChip}>{dnd.activeSample.external_id || "sample"}</div> : null}
        </DragOverlay>
      </DndContext>

      {dnd.pendingPlacement && (
        <CellChoicePicker
          pending={dnd.pendingPlacement}
          runDesign={runDesign}
          onClose={() => dnd.setPendingPlacement(null)}
          onPlaced={() => dnd.setPendingPlacement(null)}
          setPlacingSlotKey={dnd.setPlacingSlotKey}
        />
      )}

      {detail && (
        <SlotDetailPopover
          stage={detail.stage}
          locked={detail.locked}
          onClose={() => setDetail(null)}
          onRemoved={() => {
            if (slotSelection.isSelected(detail.stage.cell_use_id)) slotSelection.toggle(detail.stage);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

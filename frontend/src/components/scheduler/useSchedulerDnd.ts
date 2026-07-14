import {
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useState } from "react";

import type { SlotIndex } from "@/types/schedule";
import type { DragSampleRef, PendingPlacement } from "@/types/schedulerGrid";

import { gridCoordinateGetter } from "./gridKeyboardCoordinates";

/** Payload attached to an empty slot's useDroppable. */
export interface SlotDropData {
  kind: "slot";
  instrument_serial: string;
  run_date: string;
  slot_index: SlotIndex;
  /** Set when this slot is currently showing a waiting-cell ghost placeholder - the id of
   * the specific cell it represents (see waitingCells.ts). A sample dropped directly here
   * unambiguously means "reuse this cell", so it skips the cell-choice popup. */
  ghostCellId?: number;
}

/** Payload attached to a backlog sample card's useDraggable. */
export interface SampleDragData {
  kind: "sample";
  sample: DragSampleRef;
}

/** Payload attached to a filled slot's useDraggable (moving a placed sample). */
export interface FilledSlotDragData {
  kind: "filledSlot";
  sample: DragSampleRef;
  cell_use_id: number;
  instrument_serial: string;
  run_date: string;
  slot_index: SlotIndex;
}

export type DragData = SampleDragData | FilledSlotDragData;

export interface SchedulerDnd {
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: typeof pointerWithin;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** The sample currently being dragged (for a DragOverlay chip). */
  activeSample: DragSampleRef | null;
  /** Set when a drop lands on an empty slot - opens the CellChoicePicker. */
  pendingPlacement: PendingPlacement | null;
  setPendingPlacement: (p: PendingPlacement | null) => void;
  /** slotKey of a slot with an in-flight place/remove, for the "placing…" shimmer. */
  placingSlotKey: string | null;
  setPlacingSlotKey: (k: string | null) => void;
  /** Source instrument of an in-progress filled-slot ("move") drag, or null for a
   * backlog-sample drag (which has no source instrument) or when nothing is dragging.
   * Cells cannot move between instruments, so slots on any other instrument are made
   * ineligible drop targets while this is set. */
  activeDragInstrument: string | null;
}

/**
 * Owns the DndContext wiring: pointer + 2D-grid keyboard sensors, pointerWithin
 * collision detection (the 4 slot boxes are small and adjacent, so we want whichever
 * slot the pointer is actually inside), and the two transient bits of drag state -
 * `pendingPlacement` (drop captured, awaiting the CellChoicePicker) and
 * `placingSlotKey` (a slot mid-mutation). Instantiated once in SchedulePage.
 *
 * @param onRemoveOutside Called with a placed sample's cell_use_id when it's dragged off
 * its slot and dropped somewhere that isn't a valid drop target (e.g. off the grid
 * entirely) - the drag-and-drop equivalent of the "Remove from schedule" action.
 */
export function useSchedulerDnd(onRemoveOutside: (cellUseId: number) => void): SchedulerDnd {
  const [activeSample, setActiveSample] = useState<DragSampleRef | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [placingSlotKey, setPlacingSlotKey] = useState<string | null>(null);
  const [activeDragInstrument, setActiveDragInstrument] = useState<string | null>(null);

  // A small distance activation constraint so a click on a filled slot still opens its
  // detail popover instead of being swallowed as a drag start.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: gridCoordinateGetter }),
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data && (data.kind === "sample" || data.kind === "filledSlot")) {
      setActiveSample(data.sample);
    }
    setActiveDragInstrument(data?.kind === "filledSlot" ? data.instrument_serial : null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSample(null);
      setActiveDragInstrument(null);
      const activeData = event.active.data.current as DragData | undefined;
      const over = event.over;
      const overData = over?.data.current as SlotDropData | undefined;
      if (!overData || overData.kind !== "slot") {
        // Dropped outside any valid slot. A backlog sample was never placed, so there's
        // nothing to undo; a picked-up placed sample is removed from the schedule, same
        // as the "Remove from schedule" action.
        if (activeData?.kind === "filledSlot") onRemoveOutside(activeData.cell_use_id);
        return;
      }
      if (!activeData) return;

      if (activeData.kind === "sample") {
        setPendingPlacement({
          sample: activeData.sample,
          instrument_serial: overData.instrument_serial,
          run_date: overData.run_date,
          slot_index: overData.slot_index,
          preselectedCellId: overData.ghostCellId,
        });
        return;
      }

      // filledSlot -> ignore a no-op drop back onto itself, otherwise treat as a move.
      // Defense-in-depth: the drop target's own `disabled` droppable state (see
      // SchedulerSlot's use of activeDragInstrument) already keeps a cross-instrument drop
      // from landing at all, but guard here too in case that ever changes.
      const sameSlot =
        activeData.instrument_serial === overData.instrument_serial &&
        activeData.run_date === overData.run_date &&
        activeData.slot_index === overData.slot_index;
      if (sameSlot) return;
      if (activeData.instrument_serial !== overData.instrument_serial) return;

      setPendingPlacement({
        sample: activeData.sample,
        instrument_serial: overData.instrument_serial,
        run_date: overData.run_date,
        slot_index: overData.slot_index,
        moveFromCellUseId: activeData.cell_use_id,
      });
    },
    [onRemoveOutside],
  );

  return {
    sensors,
    collisionDetection: pointerWithin,
    onDragStart,
    onDragEnd,
    activeSample,
    pendingPlacement,
    setPendingPlacement,
    placingSlotKey,
    setPlacingSlotKey,
    activeDragInstrument,
  };
}

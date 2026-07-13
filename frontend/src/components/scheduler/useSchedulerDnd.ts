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
}

/**
 * Owns the DndContext wiring: pointer + 2D-grid keyboard sensors, pointerWithin
 * collision detection (the 4 slot boxes are small and adjacent, so we want whichever
 * slot the pointer is actually inside), and the two transient bits of drag state -
 * `pendingPlacement` (drop captured, awaiting the CellChoicePicker) and
 * `placingSlotKey` (a slot mid-mutation). Instantiated once in SchedulePage.
 */
export function useSchedulerDnd(): SchedulerDnd {
  const [activeSample, setActiveSample] = useState<DragSampleRef | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [placingSlotKey, setPlacingSlotKey] = useState<string | null>(null);

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
  }, []);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    setActiveSample(null);
    const over = event.over;
    if (!over) return;
    const overData = over.data.current as SlotDropData | undefined;
    if (!overData || overData.kind !== "slot") return;
    const activeData = event.active.data.current as DragData | undefined;
    if (!activeData) return;

    if (activeData.kind === "sample") {
      setPendingPlacement({
        sample: activeData.sample,
        instrument_serial: overData.instrument_serial,
        run_date: overData.run_date,
        slot_index: overData.slot_index,
      });
      return;
    }

    // filledSlot -> ignore a no-op drop back onto itself, otherwise treat as a move
    // (remove-then-place through the same CellChoicePicker step).
    const sameSlot =
      activeData.instrument_serial === overData.instrument_serial &&
      activeData.run_date === overData.run_date &&
      activeData.slot_index === overData.slot_index;
    if (sameSlot) return;

    setPendingPlacement({
      sample: activeData.sample,
      instrument_serial: overData.instrument_serial,
      run_date: overData.run_date,
      slot_index: overData.slot_index,
      moveFromCellUseId: activeData.cell_use_id,
    });
  }, []);

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
  };
}

import {
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useState, type RefObject } from "react";

import type { SlotIndex } from "@/types/schedule";
import type { DragSampleRef } from "@/types/schedulerGrid";

import { gridCoordinateGetter } from "./gridKeyboardCoordinates";

/** Payload attached to an empty slot's useDroppable. A grid slot is a plate LOADING position,
 * not a cell: a drop never targets a specific cell - which physical cell backs it is decided
 * server-side (reuse-before-new, then the plate is laid out ascending - see
 * placement_service.derive_best_cell / _resequence_plate) and shown afterward on the card's stub. */
export interface SlotDropData {
  kind: "slot";
  instrument_serial: string;
  load_date: string;
  slot_index: SlotIndex;
}

/** Payload attached to a filled slot's useDroppable (a placed sample dropped onto it). Carries
 * its own slot key so a swap can drive the same "placing…" shimmer autoPlace/move already do
 * on their destination slot - both slots involved in a swap change what they show. */
export interface OccupiedSlotDropData {
  kind: "occupiedSlot";
  cell_use_id: number;
  instrument_serial: string;
  load_date: string;
  slot_index: SlotIndex;
}

export type DropData = SlotDropData | OccupiedSlotDropData;

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
  cell_id: number;
  instrument_serial: string;
  load_date: string;
  slot_index: SlotIndex;
}

export type DragData = SampleDragData | FilledSlotDragData;

/** Whether a drag ended within the grid's own bounds even though it didn't land on any
 * registered droppable - the pointer's final position (the drag's own activatorEvent, its
 * starting clientX/Y, plus dnd-kit's own accumulated `delta` - the standard way to recover a
 * drop's true final position, since `active.rect.current.translated` is not reliably
 * up to date by the time onDragEnd fires) overlaps the grid container. Distinguishes "aimed at
 * the grid but hit a non-interactive area" (a locked run, a permanently blocked well, a
 * weekend/down/no-run day - none of which register a droppable, see SchedulerSlot/
 * SchedulerDayCell) from "genuinely dragged off the grid entirely" - only the latter should
 * ever mean "remove this placement" (see onDragEnd below). Returns false (never "within the
 * grid") when the container is unavailable or the drag was keyboard-activated (its
 * activatorEvent carries no pointer coordinates), so an unresolvable case falls back to the
 * pre-existing "outside the grid" behaviour rather than silently blocking a real off-grid
 * removal. */
function isWithinGrid(event: DragEndEvent, gridAreaRef: RefObject<HTMLElement | null> | undefined): boolean {
  // gridAreaRef itself is a `display: contents` wrapper (SchedulePage's .gridArea - deliberately
  // boxless so it can scope the barcode/notes/density toggles without affecting layout), so its
  // OWN getBoundingClientRect is always a zero rect. Its child SchedulerGrid's own root (the
  // horizontally-scrolling table wrapper) is the first real box and spans the actual visible
  // grid, so measure that instead.
  const scrollEl = gridAreaRef?.current?.querySelector<HTMLElement>('[class*="gridScroll"]');
  const container = scrollEl?.getBoundingClientRect();
  if (!container) return false;
  const activator = event.activatorEvent;
  if (!(activator instanceof MouseEvent)) return false; // keyboard drag - no pointer coordinates to recover
  const cx = activator.clientX + event.delta.x;
  const cy = activator.clientY + event.delta.y;
  return cx >= container.left && cx <= container.right && cy >= container.top && cy <= container.bottom;
}

export interface SchedulerDnd {
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: typeof pointerWithin;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** The sample currently being dragged (for a DragOverlay chip). */
  activeSample: DragSampleRef | null;
  /** slotKey of a slot with an in-flight place/remove, for the "placing…" shimmer. */
  placingSlotKey: string | null;
  setPlacingSlotKey: (k: string | null) => void;
}

/**
 * Owns the DndContext wiring: pointer + 2D-grid keyboard sensors, pointerWithin
 * collision detection (the 4 slot boxes are small and adjacent, so we want whichever
 * slot the pointer is actually inside), and `placingSlotKey` (a slot mid-mutation).
 * Instantiated once in SchedulePage.
 *
 * @param onRemoveOutside Called with a placed sample's cell_use_id when it's dragged off
 * its slot and dropped somewhere that isn't a valid drop target (e.g. off the grid
 * entirely) - the drag-and-drop equivalent of the "Remove from schedule" action.
 * @param onSwap Called with the dragged and target cell_use_ids, plus the target's own
 * (instrument, day, slot) so the caller can drive its "placing…" shimmer the same way
 * autoPlace/move do, when a placed sample is dropped onto a *different* already-occupied
 * slot - the two samples exchange places.
 * @param onAutoPlace Called when a backlog sample is dropped onto an empty slot - the backend
 * derives the cell (reuse-before-new), so no picker is shown.
 * @param onMove Called when an already-placed sample is dragged to a different (instrument,
 * day, slot) - the backend keeps its cell only for a same-well reschedule (same slot, another
 * day) and auto-derives the destination slot's own cell otherwise (see move_sample), so no
 * picker is shown here either.
 * @param onDropBlocked Called with a human-readable reason whenever a drop is rejected without
 * ever reaching the backend: a backlog sample dropped onto an already-occupied slot (nothing to
 * swap with), or any drop that lands within the grid's own bounds but not on a registered
 * droppable (a locked run, a permanently blocked well, a weekend/down/no-run day - see
 * isWithinGrid). Every one of these used to be a silent no-op (or, for an already-placed
 * sample, silently deleted it via onRemoveOutside - see the docstring there) with no visible
 * cause; this is the single channel that now surfaces one.
 * @param gridAreaRef The grid's own scroll/layout container, so a rejected drop landing inside
 * it can be told apart from a drag genuinely let go outside the whole grid (still a removal,
 * unchanged - see onRemoveOutside).
 */
export function useSchedulerDnd(
  onRemoveOutside: (cellUseId: number) => void,
  onSwap: (
    draggedCellUseId: number,
    targetCellUseId: number,
    targetInstrumentSerial: string,
    targetLoadDate: string,
    targetSlotIndex: SlotIndex,
  ) => void,
  onAutoPlace: (sampleId: number, instrumentSerial: string, loadDate: string, slotIndex: SlotIndex) => void,
  onMove: (cellUseId: number, instrumentSerial: string, loadDate: string, slotIndex: SlotIndex) => void,
  onDropBlocked: (message: string) => void,
  gridAreaRef?: RefObject<HTMLElement | null>,
): SchedulerDnd {
  const [activeSample, setActiveSample] = useState<DragSampleRef | null>(null);
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

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSample(null);
      const activeData = event.active.data.current as DragData | undefined;
      const over = event.over;
      const overData = over?.data.current as DropData | undefined;
      if (!overData || (overData.kind !== "slot" && overData.kind !== "occupiedSlot")) {
        // Dropped outside any registered slot. If the pointer/keyboard-drag is still within
        // the grid's own bounds, it landed on a non-interactive area that never registers a
        // droppable at all (a locked run, a permanently blocked well, a weekend/down/no-run
        // day) - that's a rejected drop, never a removal, and must not fall through to the
        // "dragged off the grid entirely" meaning below (which deletes a placed sample).
        if (activeData && isWithinGrid(event, gridAreaRef)) {
          onDropBlocked("Can't drop here - this day/slot is locked, blocked, or not open for scheduling.");
          return;
        }
        // Genuinely outside the whole grid: a backlog sample was never placed, so there's
        // nothing to undo; a picked-up placed sample is removed from the schedule, same
        // as the "Remove from schedule" action.
        if (activeData?.kind === "filledSlot") onRemoveOutside(activeData.cell_use_id);
        return;
      }
      if (!activeData) return;

      if (overData.kind === "occupiedSlot") {
        // Only a filled-slot drag (an already-placed sample) can land here as a swap - a
        // backlog sample dropped onto an already-occupied slot has nothing to swap with.
        if (activeData.kind !== "filledSlot") {
          onDropBlocked("That slot already holds a sample - drop elsewhere, or drag it off to swap.");
          return;
        }
        if (activeData.cell_use_id === overData.cell_use_id) return; // dropped back onto its own slot
        onSwap(
          activeData.cell_use_id,
          overData.cell_use_id,
          overData.instrument_serial,
          overData.load_date,
          overData.slot_index,
        );
        return;
      }

      if (activeData.kind === "sample") {
        // A grid slot is a plate loading position, not a cell: a drop never targets a specific
        // cell. Place it and let the backend derive the cell (reuse-before-new) - no drop-time
        // picker. The chosen cell shows as the card's stub.
        onAutoPlace(activeData.sample.id, overData.instrument_serial, overData.load_date, overData.slot_index);
        return;
      }

      // filledSlot -> a move. Ignore a no-op drop back onto itself; otherwise re-plan it. A
      // sample isn't physically loaded onto anything until its run executes, so a move just
      // re-plans it: the backend keeps its own cell only for a same-well reschedule (same slot,
      // another day), and auto-derives the destination slot's own cell for any different-well
      // move (different slot, instrument, or tray position) - no picker.
      const sameSlot =
        activeData.instrument_serial === overData.instrument_serial &&
        activeData.load_date === overData.load_date &&
        activeData.slot_index === overData.slot_index;
      if (sameSlot) return;

      onMove(activeData.cell_use_id, overData.instrument_serial, overData.load_date, overData.slot_index);
    },
    [onRemoveOutside, onSwap, onAutoPlace, onMove, onDropBlocked, gridAreaRef],
  );

  return {
    sensors,
    collisionDetection: pointerWithin,
    onDragStart,
    onDragEnd,
    activeSample,
    placingSlotKey,
    setPlacingSlotKey,
  };
}

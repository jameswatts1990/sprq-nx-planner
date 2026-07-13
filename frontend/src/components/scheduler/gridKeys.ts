import type { SlotIndex } from "@/types/schedule";

/** Stable string key for one (instrument, day) grid cell. */
export function cellKey(instrumentSerial: string, runDate: string): string {
  return `${instrumentSerial}::${runDate}`;
}

/** Stable string key for one slot box within a cell - also the dnd-kit droppable/
 * draggable id for that slot. */
export function slotKey(instrumentSerial: string, runDate: string, slotIndex: SlotIndex): string {
  return `${instrumentSerial}::${runDate}::${slotIndex}`;
}

/** dnd-kit draggable id for a backlog sample card. */
export function sampleDragId(sampleId: number): string {
  return `sample::${sampleId}`;
}

export const SLOT_INDICES: SlotIndex[] = [0, 1, 2, 3];

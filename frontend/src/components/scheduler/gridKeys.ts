import type { SlotIndex } from "@/types/schedule";

/** Stable string key for one (instrument, load day) grid cell. */
export function cellKey(instrumentSerial: string, loadDate: string): string {
  return `${instrumentSerial}::${loadDate}`;
}

/** Stable string key for one slot box within a cell - also the dnd-kit droppable/
 * draggable id for that slot. Keeps its 0-7 shape (unchanged from the pre-plate model) so
 * dnd-kit ids don't churn. */
export function slotKey(instrumentSerial: string, loadDate: string, slotIndex: SlotIndex): string {
  return `${instrumentSerial}::${loadDate}::${slotIndex}`;
}

/** dnd-kit draggable id for a backlog sample card. */
export function sampleDragId(sampleId: number): string {
  return `sample::${sampleId}`;
}

export const SLOT_INDICES: SlotIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** The two loading positions of a run: Plate 1 = slots 0-3, Plate 2 = slots 4-7. (This grid
 * "plate" is a loading position - a distinct concept from a physical 4-cell SMRT tray, which
 * lives on the Cells page.) */
export const PLATE_INDICES: SlotIndex[][] = [SLOT_INDICES.slice(0, 4) as SlotIndex[], SLOT_INDICES.slice(4, 8) as SlotIndex[]];

/** Which plate (0 = Plate 1, 1 = Plate 2) a given grid slot index belongs to. */
export function plateOfSlot(slotIndex: SlotIndex): number {
  return slotIndex < 4 ? 0 : 1;
}

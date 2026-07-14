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

export const SLOT_INDICES: SlotIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** Two 4-cell trays per run: tray 1 = slots 0-3, tray 2 = slots 4-7. */
export const TRAY_INDICES: SlotIndex[][] = [SLOT_INDICES.slice(0, 4) as SlotIndex[], SLOT_INDICES.slice(4, 8) as SlotIndex[]];

/** Which tray (0 or 1) a given slot index belongs to. */
export function trayOfSlot(slotIndex: SlotIndex): number {
  return slotIndex < 4 ? 0 : 1;
}

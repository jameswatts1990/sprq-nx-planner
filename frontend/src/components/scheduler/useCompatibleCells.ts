import { useQuery } from "@tanstack/react-query";

import { cellsApi } from "@/api/cells";
import type { CellOut } from "@/types/cell";

export interface UseCompatibleCellsOptions {
  instrumentSerial: string;
  sampleBarcodes: string[];
  /** Excluded from the compatible list - e.g. the cell a placement is already on, when
   * offering a swap to a *different* cell. */
  excludeCellId?: number;
  /** The well this placement would land in. Cells stay in the same physical tray/well
   * position for every reuse, so a cell that's already been used once is only offered
   * here if this well matches the one it's already pinned to - a brand-new-to-reuse
   * cell (current_well null) has no such constraint yet. */
  targetWell?: string;
  enabled?: boolean;
}

/** Returns true if this open cell can host the sample: it has an unused use left, none
 * of its already-burned barcodes clash with the sample's barcodes, and (once it has a
 * prior use) the target well matches the one it's already pinned to. Shared by the
 * placement picker (CellChoicePicker) and the "change cell" action (SlotDetailPopover)
 * so both surfaces agree on one compatibility ruleset. */
function isCompatible(cell: CellOut, sampleBarcodes: string[], excludeCellId?: number, targetWell?: string): boolean {
  if (cell.id === excludeCellId) return false;
  if (cell.current_well !== null && targetWell !== undefined && cell.current_well !== targetWell) return false;
  return cell.uses_consumed < cell.max_uses && !cell.burned_barcodes.some((b) => sampleBarcodes.includes(b));
}

export function useCompatibleCells({
  instrumentSerial,
  sampleBarcodes,
  excludeCellId,
  targetWell,
  enabled = true,
}: UseCompatibleCellsOptions) {
  const cellsQuery = useQuery({
    queryKey: ["cells", { status: "open", instrument_serial: instrumentSerial }],
    queryFn: () => cellsApi.listAll({ status: "open", instrument_serial: instrumentSerial }),
    enabled,
  });

  const compatible = enabled
    ? (cellsQuery.data ?? [])
        .filter((c) => isCompatible(c, sampleBarcodes, excludeCellId, targetWell))
        // Group cells from the same physical SPRQ-Nx SMRT Cell tray together, in
        // cell-number (tray_position) order, so a tray's siblings render adjacently
        // rather than scattered through the API's newest-first order.
        .sort((a, b) => {
          if (a.tray_id !== b.tray_id) {
            if (a.tray_id === null) return 1;
            if (b.tray_id === null) return -1;
            return a.tray_id - b.tray_id;
          }
          return (a.tray_position ?? 0) - (b.tray_position ?? 0);
        })
    : [];

  return { cellsQuery, compatible };
}

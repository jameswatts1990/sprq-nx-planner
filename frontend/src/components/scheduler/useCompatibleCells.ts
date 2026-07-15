import { useQuery } from "@tanstack/react-query";

import { cellsApi } from "@/api/cells";
import type { CellOut } from "@/types/cell";

export interface UseCompatibleCellsOptions {
  instrumentSerial: string;
  sampleBarcodes: string[];
  /** Excluded from the compatible list - e.g. the cell a placement is already on, when
   * offering a swap to a *different* cell. */
  excludeCellId?: number;
  enabled?: boolean;
}

/** Returns true if this open cell can host the sample: it has an unused use left, and
 * none of its already-burned barcodes clash with the sample's barcodes. Shared by the
 * placement picker (CellChoicePicker) and the "change cell" action (SlotDetailPopover)
 * so both surfaces agree on one compatibility ruleset. */
function isCompatible(cell: CellOut, sampleBarcodes: string[], excludeCellId?: number): boolean {
  if (cell.id === excludeCellId) return false;
  return cell.uses_consumed < cell.max_uses && !cell.burned_barcodes.some((b) => sampleBarcodes.includes(b));
}

export function useCompatibleCells({
  instrumentSerial,
  sampleBarcodes,
  excludeCellId,
  enabled = true,
}: UseCompatibleCellsOptions) {
  const cellsQuery = useQuery({
    queryKey: ["cells", { status: "open", instrument_serial: instrumentSerial, page_size: 200 }],
    queryFn: () => cellsApi.list({ status: "open", instrument_serial: instrumentSerial, page_size: 200 }),
    enabled,
  });

  const compatible = enabled
    ? (cellsQuery.data?.items ?? []).filter((c) => isCompatible(c, sampleBarcodes, excludeCellId))
    : [];

  return { cellsQuery, compatible };
}

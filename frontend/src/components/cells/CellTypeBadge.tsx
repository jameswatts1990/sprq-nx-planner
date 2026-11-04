import { Badge } from "@/components/ui/Badge";
import type { CellType } from "@/types/common";

export interface CellTypeBadgeProps {
  cellType: CellType | undefined;
  compact?: boolean;
}

/** An indigo "SPRQ" pill marking a single-use SPRQ run, tray or cell. Renders nothing for
 * SPRQ-Nx - the everyday type needs no label, so only the exception stands out. */
export function CellTypeBadge({ cellType, compact = false }: CellTypeBadgeProps) {
  if (cellType !== "sprq") return null;
  return (
    <Badge tone="sprq" compact={compact} title="Single-use SPRQ cells - each cell runs once (no reuse)">
      SPRQ
    </Badge>
  );
}

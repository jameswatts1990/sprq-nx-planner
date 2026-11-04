import type { CellType } from "@/types/common";

/** Display names for a cell's type - PacBio's own product names. */
export const CELL_TYPE_LABEL: Record<CellType, string> = {
  sprq_nx: "SPRQ-Nx",
  sprq: "SPRQ",
};

/** The type a brand-new run starts with - the load-time dial's toggle resets to this. */
export const DEFAULT_CELL_TYPE: CellType = "sprq_nx";

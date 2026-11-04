import type { CellType } from "@/types/common";

export type UseClass = "u1" | "u2" | "u3" | "sprq";

/**
 * Maps a 1-based use number to the u1/u2/u3 color class used throughout the app
 * (magenta/blue/teal), clamping anything beyond use 3 down to the "u3" tint.
 *
 * Named `classForUseIndex` (not `useIndexClass`) so eslint-plugin-react-hooks doesn't
 * mistake it for a React hook - it is a plain, pure function.
 */
export function classForUseIndex(oneBasedUseNumber: number): UseClass {
  const clamped = Math.min(3, Math.max(1, oneBasedUseNumber));
  return `u${clamped}` as UseClass;
}

/** The colour class for one use of a cell: a single-use SPRQ cell always reads in its own SPRQ
 * colour (it's only ever Use 1 of 1); a SPRQ-Nx cell takes its Use 1/2/3 colour. */
export function classForCell(oneBasedUseNumber: number, cellType: CellType | undefined): UseClass {
  return cellType === "sprq" ? "sprq" : classForUseIndex(oneBasedUseNumber);
}

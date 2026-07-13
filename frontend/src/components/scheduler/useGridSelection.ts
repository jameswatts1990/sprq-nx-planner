import { useCallback, useMemo, useState } from "react";

interface Coord {
  r: number;
  c: number;
}

export interface GridSelection {
  /** Whether cell (rowIndex, colIndex) falls inside the current rectangular range. */
  isInRange: (r: number, c: number) => boolean;
  /** True when there is any active range. */
  hasSelection: boolean;
  /** Handle a click on a cell: plain click sets a single-cell anchor (or toggles it
   * off if it was the only selected cell); shift-click extends the rectangle from the
   * anchor to this cell. */
  handleCellClick: (r: number, c: number, shift: boolean) => void;
  clear: () => void;
}

function normalize(a: Coord, b: Coord) {
  return {
    r0: Math.min(a.r, b.r),
    r1: Math.max(a.r, b.r),
    c0: Math.min(a.c, b.c),
    c1: Math.max(a.c, b.c),
  };
}

/**
 * Spreadsheet-style rectangular grid selection over instrument-row-index x
 * day-column-index. Holds an anchor + head; the selected rectangle is their bounding
 * box. Purely geometric - the page intersects the rectangle with the currently
 * selectable (empty, non-weekend) cells to derive the concrete auto-fill payload, so
 * the selection self-heals as grid data changes.
 */
export function useGridSelection(): GridSelection {
  const [anchor, setAnchor] = useState<Coord | null>(null);
  const [head, setHead] = useState<Coord | null>(null);

  const range = useMemo(() => (anchor && head ? normalize(anchor, head) : null), [anchor, head]);

  const isInRange = useCallback(
    (r: number, c: number) => {
      if (!range) return false;
      return r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
    },
    [range],
  );

  const handleCellClick = useCallback(
    (r: number, c: number, shift: boolean) => {
      if (shift && anchor) {
        setHead({ r, c });
        return;
      }
      // Plain click on the current sole selection clears it; otherwise start fresh.
      if (anchor && head && anchor.r === r && anchor.c === c && head.r === r && head.c === c) {
        setAnchor(null);
        setHead(null);
        return;
      }
      setAnchor({ r, c });
      setHead({ r, c });
    },
    [anchor, head],
  );

  const clear = useCallback(() => {
    setAnchor(null);
    setHead(null);
  }, []);

  return { isInRange, hasSelection: range !== null, handleCellClick, clear };
}

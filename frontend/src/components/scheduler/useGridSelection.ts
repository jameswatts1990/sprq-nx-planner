import { useCallback, useState } from "react";

interface Coord {
  r: number;
  c: number;
}

export interface GridSelection {
  /** Whether cell (rowIndex, colIndex) is currently selected. */
  isSelected: (r: number, c: number) => boolean;
  /** True when there is any active selection. */
  hasSelection: boolean;
  /** Handle a click on a cell:
   *  - plain click selects just this cell (or clears it if it was the sole selection)
   *  - ctrl/cmd-click toggles this cell in/out of the selection, on top of whatever
   *    else is already selected (disjoint multi-select)
   *  - shift-click extends a rectangle from the last clicked cell to this one */
  handleCellClick: (r: number, c: number, shift: boolean, ctrl: boolean) => void;
  clear: () => void;
}

function key(r: number, c: number): string {
  return `${r},${c}`;
}

function rectKeys(a: Coord, b: Coord): string[] {
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const out: string[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) out.push(key(r, c));
  }
  return out;
}

/**
 * Grid selection over instrument-row-index x day-column-index, supporting both
 * spreadsheet-style rectangle selection (shift-click from the last anchor) and
 * disjoint multi-select (ctrl/cmd-click toggles individual cells). Purely geometric -
 * the page intersects the selection with the currently selectable (empty, non-weekend)
 * cells to derive the concrete auto-fill payload, so the selection self-heals as grid
 * data changes.
 */
export function useGridSelection(): GridSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<Coord | null>(null);

  const isSelected = useCallback((r: number, c: number) => selected.has(key(r, c)), [selected]);

  const handleCellClick = useCallback(
    (r: number, c: number, shift: boolean, ctrl: boolean) => {
      if (shift && anchor) {
        setSelected(new Set(rectKeys(anchor, { r, c })));
        return;
      }

      if (ctrl) {
        setSelected((prev) => {
          const next = new Set(prev);
          const k = key(r, c);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          return next;
        });
        setAnchor({ r, c });
        return;
      }

      // Plain click on the current sole selection clears it; otherwise selects just this cell.
      setSelected((prev) => (prev.size === 1 && prev.has(key(r, c)) ? new Set() : new Set([key(r, c)])));
      setAnchor({ r, c });
    },
    [anchor],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  return { isSelected, hasSelection: selected.size > 0, handleCellClick, clear };
}

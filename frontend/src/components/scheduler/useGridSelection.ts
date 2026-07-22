import { useCallback, useMemo, useState } from "react";

export interface Coord {
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
  /** Set a whole row/column from a header click. Plain click replaces the selection with
   * exactly these coordinates (or clears it if that's already the current selection).
   * Ctrl/cmd-click is additive instead: it unions these coordinates into whatever else is
   * already selected, so multiple days and/or multiple instruments can be built up one
   * header-click at a time - unless every one of these coordinates is already selected, in
   * which case it removes just this set (so re-ctrl-clicking a header toggles it off). */
  selectMany: (coords: Coord[], ctrl?: boolean) => void;
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
 * disjoint multi-select (ctrl/cmd-click toggles individual cells, or unions in a whole
 * row/column/everything via selectMany's ctrl flag - see SchedulerGrid/SchedulerGridRow's
 * header click handlers). Purely geometric - the page intersects the selection with the
 * currently selectable (empty, non-weekend) cells to derive the concrete auto-fill
 * payload, so the selection self-heals as grid data changes.
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

  const selectMany = useCallback((coords: Coord[], ctrl = false) => {
    setSelected((prev) => {
      const nextKeys = coords.map(({ r, c }) => key(r, c));
      if (ctrl) {
        const next = new Set(prev);
        const allAlreadySelected = nextKeys.length > 0 && nextKeys.every((k) => prev.has(k));
        nextKeys.forEach((k) => (allAlreadySelected ? next.delete(k) : next.add(k)));
        return next;
      }
      const next = new Set(nextKeys);
      const unchanged = prev.size === next.size && nextKeys.every((k) => prev.has(k));
      return unchanged ? new Set() : next;
    });
    setAnchor(coords.length > 0 ? coords[coords.length - 1] : null);
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  // Memoized so consumers (SchedulePage's selectedCells memo, the memoized grid rows) get a
  // stable object identity that only changes when the selection actually changes.
  return useMemo(
    () => ({ isSelected, hasSelection: selected.size > 0, handleCellClick, selectMany, clear }),
    [isSelected, selected.size, handleCellClick, selectMany, clear],
  );
}

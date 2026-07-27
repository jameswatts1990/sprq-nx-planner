import { useCallback, useMemo, useState } from "react";

import type { SortDir } from "@/components/shared/SortableColumnHeader";

/** A cell's sortable value. `null`/`undefined` (an empty cell) always sorts last. */
type SortValue = string | number | null | undefined;

export interface ClientSort<K extends string> {
  sortBy: K;
  sortDir: SortDir;
  /** Click a column: first click sorts ascending, clicking the active column flips it. */
  toggle: (key: K) => void;
}

/**
 * Client-side table sorting for tables whose rows are all loaded at once (no server
 * pagination) — the Backlog's Top-up list and the History cell-use lists. Give it the rows
 * and one accessor per sortable column; it returns the rows in sorted order plus the state a
 * {@link SortableColumnHeader} needs. Strings sort case-insensitively; empty cells sink to
 * the bottom regardless of direction, matching the server-sorted sample tables.
 */
export function useClientSort<T, K extends string>(
  items: T[],
  accessors: Record<K, (item: T) => SortValue>,
  // `NoInfer` keeps K inferred from `accessors` (the full column-key union) — otherwise the
  // literal passed here (e.g. "container") narrows K to that single key and every
  // `sortBy === "otherKey"` comparison becomes a "no overlap" type error.
  initial: { by: NoInfer<K>; dir?: SortDir },
): { sorted: T[] } & ClientSort<K> {
  const [sortBy, setSortBy] = useState<K>(initial.by);
  const [sortDir, setSortDir] = useState<SortDir>(initial.dir ?? "asc");

  const toggle = useCallback((key: K) => {
    setSortBy((cur) => {
      if (cur === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return cur;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sorted = useMemo(() => {
    const accessor = accessors[sortBy];
    const factor = sortDir === "asc" ? 1 : -1;
    // Sort a copy so we never mutate the caller's array. Decorate with the original index
    // for a stable tie-break (Array.prototype.sort is stable, but the null-last split below
    // reorders, so an explicit index keeps equal rows in their original order).
    return items
      .map((item, index) => ({ item, index, value: accessor(item) }))
      .sort((a, b) => {
        const aEmpty = a.value == null || a.value === "";
        const bEmpty = b.value == null || b.value === "";
        if (aEmpty || bEmpty) {
          if (aEmpty && bEmpty) return a.index - b.index;
          return aEmpty ? 1 : -1; // empties always last, either direction
        }
        let cmp: number;
        if (typeof a.value === "number" && typeof b.value === "number") {
          cmp = a.value - b.value;
        } else {
          cmp = String(a.value).localeCompare(String(b.value), undefined, { sensitivity: "base" });
        }
        return cmp !== 0 ? cmp * factor : a.index - b.index;
      })
      .map((d) => d.item);
  }, [items, accessors, sortBy, sortDir]);

  return { sorted, sortBy, sortDir, toggle };
}

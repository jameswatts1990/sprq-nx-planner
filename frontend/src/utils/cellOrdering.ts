import type { CellOut } from "@/types/cell";
import { windowHoursRemaining } from "@/utils/openTrays";

/** Sort/group helpers for the Cells page. Kept out of the component so the ordering rules
 * (and their nulls-last / stable-tie-break behaviour) are described in one place. */

export type CellSortKey = "code" | "last_run" | "instrument" | "window" | "created";
export type SortDir = "asc" | "desc";
export type CellGroupKey = "tray" | "instrument" | "status" | "none";

/** Each sort key carries the direction that reads most naturally when you first pick it
 * (newest-first for dates, A→Z for names, most-urgent-first for the window countdown) - the
 * page seeds the direction toggle from this whenever the key changes. */
export const CELL_SORT_OPTIONS: { value: CellSortKey; label: string; defaultDir: SortDir }[] = [
  { value: "code", label: "Cell code", defaultDir: "asc" },
  { value: "last_run", label: "Last run date", defaultDir: "desc" },
  { value: "instrument", label: "Instrument", defaultDir: "asc" },
  { value: "window", label: "Window remaining", defaultDir: "asc" },
  { value: "created", label: "Date created", defaultDir: "desc" },
];

export const CELL_GROUP_OPTIONS: { value: CellGroupKey; label: string }[] = [
  { value: "tray", label: "Tray" },
  { value: "instrument", label: "Instrument" },
  { value: "status", label: "Status" },
  { value: "none", label: "No grouping" },
];

/** Natural (numeric-aware) compare of two cell codes - the stable tie-break for every
 * sort, so equal-key cells always fall into a predictable order (e.g. C01-T7 before
 * C02-T7, and T7 before T10). */
function codeCompare(a: CellOut, b: CellOut): number {
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

/** The comparable value a sort key reads off a cell; null means "no value" and always
 * sorts to the end regardless of direction (so an unused cell with no last-run date, or a
 * sibling with no active window, never jumps to the top just because the sort flipped). */
function sortValue(cell: CellOut, key: CellSortKey): string | number | null {
  switch (key) {
    case "code":
      return cell.code;
    case "last_run":
      return cell.last_use_run_date; // 'YYYY-MM-DD' - lexicographically ordered
    case "instrument":
      return cell.current_instrument_serial;
    case "window":
      return windowHoursRemaining(cell);
    case "created":
      return cell.created_at; // ISO 8601 - lexicographically ordered
  }
}

export function sortCells(cells: CellOut[], key: CellSortKey, dir: SortDir): CellOut[] {
  const dirMul = dir === "asc" ? 1 : -1;
  return [...cells].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return codeCompare(a, b);
    if (av === null) return 1; // nulls last
    if (bv === null) return -1;
    if (av < bv) return -1 * dirMul;
    if (av > bv) return 1 * dirMul;
    return codeCompare(a, b);
  });
}

export interface CellGroup {
  /** Stable group id (React key). */
  id: string;
  cells: CellOut[];
}

/** Group already-sorted cells, preserving the order groups first appear in (so group order
 * follows the active sort). Grouping by tray additionally orders each tray's cells by their
 * fixed tray position (C01…C04), matching how a physical tray of four reads. */
export function groupCells(sortedCells: CellOut[], group: CellGroupKey): CellGroup[] {
  if (group === "none") {
    return [{ id: "all", cells: sortedCells }];
  }
  const groups = new Map<string, CellOut[]>();
  for (const cell of sortedCells) {
    let id: string;
    if (group === "tray") id = cell.tray_id === null ? "no-tray" : `tray-${cell.tray_id}`;
    else if (group === "instrument") id = cell.current_instrument_serial ?? "no-instrument";
    else id = cell.status;
    const bucket = groups.get(id);
    if (bucket) bucket.push(cell);
    else groups.set(id, [cell]);
  }
  const result = [...groups.entries()].map(([id, cells]) => ({ id, cells }));
  if (group === "tray") {
    for (const g of result) g.cells.sort((a, b) => (a.tray_position ?? 0) - (b.tray_position ?? 0));
  }
  return result;
}

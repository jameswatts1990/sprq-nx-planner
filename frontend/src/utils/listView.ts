import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useDebouncedValue } from "@/utils/useDebouncedValue";

/** Shared plumbing for the list pages (Cells, Run history, Samples). Each keeps its whole view -
 * filters, search, sort, page and page size - in the URL, so Back from anything opened off the
 * list returns to exactly that list, and a filtered view can be linked to. */

export type SortDir = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100, 200];

/** The fields every list view has; each page adds its own filters. */
export interface ListView<S extends string = string> {
  q: string;
  sort: S;
  dir: SortDir;
  page: number;
  pageSize: number;
}

export interface ListViewSpec<V extends ListView> {
  defaults: V;
  /** URL key for each field. */
  keys: Record<keyof V, string>;
  /** The view a URL describes - anything missing or unrecognised falls back to the default. */
  read: (params: URLSearchParams) => V;
  /** The direction that reads most naturally when a column is first picked (clicking again flips
   * it) - also the list of sortable columns. */
  sortDefaultDir: Record<V["sort"], SortDir>;
}

export function positiveInt(raw: string | null): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/** `raw` when it's one of `allowed`, else `fallback`. */
export function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** The common fields of a URL's view, validated - for a spec's `read`. */
export function readListFields<V extends ListView>(
  params: URLSearchParams,
  spec: Omit<ListViewSpec<V>, "read">,
): ListView<V["sort"]> {
  const { keys, defaults } = spec;
  const size = positiveInt(params.get(keys.pageSize));
  return {
    q: params.get(keys.q) ?? defaults.q,
    sort: oneOf(params.get(keys.sort), Object.keys(spec.sortDefaultDir) as V["sort"][], defaults.sort),
    dir: oneOf(params.get(keys.dir), ["asc", "desc"], defaults.dir),
    page: positiveInt(params.get(keys.page)) ?? defaults.page,
    pageSize: size && PAGE_SIZES.includes(size) ? size : defaults.pageSize,
  };
}

/** `prev` with `patch` applied - defaults are left out of the URL so it stays short. Changing
 * anything but the page sends the list back to page 1. Unrelated params are kept. */
export function writeListView<V extends ListView>(
  spec: ListViewSpec<V>,
  prev: URLSearchParams,
  patch: Partial<V>,
): URLSearchParams {
  const current = spec.read(prev);
  const next = new URLSearchParams(prev);
  const merged: V = { ...current, ...patch };
  const filterChanged = (Object.keys(patch) as (keyof V)[]).some((k) => k !== "page" && patch[k] !== current[k]);
  if (filterChanged && !("page" in patch)) merged.page = 1;
  for (const k of Object.keys(spec.keys) as (keyof V)[]) {
    const value = merged[k];
    if (value === spec.defaults[k]) next.delete(spec.keys[k]);
    else next.set(spec.keys[k], String(value));
  }
  return next;
}

/** A list page's view from the URL; `update` writes a patch back (replacing the history entry);
 * `onSort` is the column-header handler; `search`/`setSearch` drive the search box. `spec` must
 * be a module-level constant.
 *
 * The search box is local while typing and written to the URL once it settles - that write is
 * what fetches. A search changed from outside the box (Back, a link) is adopted, but our own
 * write never echoes back over newer keystrokes. */
export function useListView<V extends ListView>(spec: ListViewSpec<V>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = spec.read(searchParams);

  const update = useCallback(
    (patch: Partial<V>) => setSearchParams((prev) => writeListView(spec, prev, patch), { replace: true }),
    [setSearchParams, spec],
  );

  const onSort = useCallback(
    (key: V["sort"]) =>
      update(
        (key === view.sort
          ? { dir: view.dir === "asc" ? "desc" : "asc" }
          : { sort: key, dir: spec.sortDefaultDir[key] }) as Partial<V>,
      ),
    [update, view.sort, view.dir, spec],
  );

  const [search, setSearch] = useState(view.q);
  const typed = useDebouncedValue(search.trim(), 350);
  const [pushed, setPushed] = useState(view.q);
  const [seen, setSeen] = useState(view.q);
  if (view.q !== seen) {
    setSeen(view.q);
    if (view.q !== typed) setSearch(view.q);
  }
  useEffect(() => {
    if (typed === pushed) return;
    setPushed(typed);
    update({ q: typed } as Partial<V>);
  }, [typed, pushed, update]);

  return { view, update, onSort, search, setSearch };
}

/** Snap a page past the end (the list shrank since the link was made) back to the last page,
 * once the real (not placeholder) result is in. */
export function useClampPage(
  settled: boolean,
  page: number,
  totalPages: number,
  update: (patch: { page: number }) => void,
): void {
  useEffect(() => {
    if (settled && page > totalPages) update({ page: totalPages });
  }, [settled, page, totalPages, update]);
}

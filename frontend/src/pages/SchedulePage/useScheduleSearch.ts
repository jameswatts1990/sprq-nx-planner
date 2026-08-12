import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cyclesApi } from "@/api/cycles";
import { samplesApi } from "@/api/samples";
import { slotKey } from "@/components/scheduler/gridKeys";
import type { RunOut, SlotIndex } from "@/types/schedule";
import type { SampleOut } from "@/types/sample";
import { runLabel } from "@/utils/runLabel";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

/** A placed grid slot the search matched, anywhere across the whole timeline. */
export interface PlacementMatch {
  kind: "placement";
  key: string;
  loadDate: string;
  instrumentSerial: string;
  slotIndex: SlotIndex;
  slotKey: string;
  label: string;
}
/** A backlog sample the search matched. */
export interface BacklogMatch {
  kind: "backlog";
  key: string;
  sampleId: number;
  poolId: string;
  label: string;
}
/** One appearance the unified search can cycle to. */
export type SearchMatch = PlacementMatch | BacklogMatch;

/** Cap on how many backlog matches the cycle covers - a text search of the backlog is almost
 * always a handful of samples, so this only bites on a very broad query. */
const BACKLOG_MATCH_LIMIT = 200;

/** A run matches when the query is found in its name, or (for an all-digits query, optionally
 * "#"-prefixed) in its run id - so both a lab run name and a bare run number are searchable. */
function runMatches(run: RunOut, ql: string, qDigits: string): boolean {
  if (run.run_name && run.run_name.toLowerCase().includes(ql)) return true;
  if (qDigits && String(run.run_id).includes(qDigits)) return true;
  return false;
}

/** A placed well matches on its sample's Pool ID or any of its barcodes - the same
 * fields the backlog's own text search covers, so the two halves of the unified search feel
 * like one search. */
function stageMatches(poolId: string | null, barcodes: string[], ql: string): boolean {
  if (poolId && poolId.toLowerCase().includes(ql)) return true;
  return barcodes.some((b) => b.toLowerCase().includes(ql));
}

export interface ScheduleSearch {
  /** Raw, un-debounced text bound to the header search input. */
  query: string;
  setQuery: (q: string) => void;
  /** Debounced query actually driving the matches / backlog filter. */
  q: string;
  searchActive: boolean;
  matches: SearchMatch[];
  count: number;
  /** -1 until the user first cycles (Enter / ‹ ›), so typing narrows the backlog without
   * yanking the grid to another week mid-keystroke. */
  activeIndex: number;
  activeMatch: SearchMatch | null;
  next: () => void;
  prev: () => void;
  clear: () => void;
  /** slotKey of the focused grid placement (null otherwise) - fed to SearchHighlightContext. */
  highlightSlotKey: string | null;
  /** id of the focused backlog sample (null otherwise) - fed to the BacklogPanel. */
  highlightSampleId: number | null;
  /** The backlog samples matching `q`, in cycle order - handed to the BacklogPanel so its
   * displayed list is exactly the cycle order. Null when not searching (panel browses). */
  backlogItems: SampleOut[] | null;
  backlogTotal: number;
  backlogLoading: boolean;
  /** dataUpdatedAt stamp so the page can re-attempt a scroll-into-view once freshly-loaded
   * backlog matches have actually rendered. */
  backlogUpdatedAt: number;
}

/**
 * Owns the Schedule page's unified search: one query string that both filters the backlog
 * tray and finds every placement of a sample / run across the whole schedule (all weeks), so
 * the header search can cycle through all appearances even when the match sits in a week the
 * grid isn't currently showing. Its two source queries run only while a search is active.
 */
export function useScheduleSearch(): ScheduleSearch {
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query, 300);
  const trimmed = q.trim();
  const searchActive = trimmed.length > 0;
  const ql = trimmed.toLowerCase();
  const qDigits = /^#?\d+$/.test(trimmed) ? trimmed.replace(/^#/, "") : "";

  // Every run across the whole timeline (no date bounds) - the basis for finding placements
  // outside the visible week. Gated on an active search. The ["cycles"] prefix means every
  // schedule mutation's invalidateScheduleRelated refreshes it too.
  const allRunsQuery = useQuery({
    queryKey: ["cycles", "search-all"],
    queryFn: () => cyclesApi.list({}),
    enabled: searchActive,
    staleTime: 30_000,
  });

  // The backlog samples matching the query - a distinct cache entry from the BacklogPanel's
  // own browse query (that one carries q:"") so they never clobber each other, while a shared
  // ["samples"] prefix keeps both fresh after any sample mutation.
  const backlogQuery = useQuery({
    queryKey: ["samples", { status: "backlog", q: trimmed, sort_by: "priority", sort_dir: "asc", page: 1, page_size: BACKLOG_MATCH_LIMIT }],
    queryFn: () =>
      samplesApi.list({ status: "backlog", q: trimmed, sort_by: "priority", sort_dir: "asc", page: 1, page_size: BACKLOG_MATCH_LIMIT }),
    enabled: searchActive,
  });

  // Memoized so the empty-fallback doesn't hand `matches` a fresh [] identity every render.
  const backlogItemsRaw = useMemo(() => backlogQuery.data?.items ?? [], [backlogQuery.data]);

  const matches = useMemo<SearchMatch[]>(() => {
    if (!searchActive) return [];
    const placements: PlacementMatch[] = [];
    const seen = new Set<string>();
    for (const run of allRunsQuery.data ?? []) {
      const runHit = runMatches(run, ql, qDigits);
      for (const plate of run.plates) {
        for (const stage of plate.stages) {
          if (!(runHit || stageMatches(stage.sample_pool_id, stage.barcodes, ql))) continue;
          const sk = slotKey(run.instrument_serial, run.load_date, stage.slot_index);
          if (seen.has(sk)) continue;
          seen.add(sk);
          placements.push({
            kind: "placement",
            key: sk,
            loadDate: run.load_date,
            instrumentSerial: run.instrument_serial,
            slotIndex: stage.slot_index,
            slotKey: sk,
            label: `${runLabel(run)} · ${stage.sample_pool_id ?? "—"}`,
          });
        }
      }
    }
    // Chronological, then by instrument, then plate order - the order a scheduler reads the grid.
    placements.sort(
      (a, b) =>
        a.loadDate.localeCompare(b.loadDate) ||
        a.instrumentSerial.localeCompare(b.instrumentSerial) ||
        a.slotIndex - b.slotIndex,
    );
    const backlog: SearchMatch[] = backlogItemsRaw.map((s) => ({
      kind: "backlog",
      key: `b${s.id}`,
      sampleId: s.id,
      poolId: s.pool_id,
      label: s.pool_id,
    }));
    return [...placements, ...backlog];
  }, [searchActive, allRunsQuery.data, backlogItemsRaw, ql, qDigits]);

  const count = matches.length;
  const [activeIndex, setActiveIndex] = useState(-1);
  // A new query resets the cursor - the next Enter / ‹ › starts from the first match again.
  useEffect(() => {
    setActiveIndex(-1);
  }, [q]);

  const next = useCallback(() => {
    setActiveIndex((i) => (count === 0 ? -1 : i < 0 ? 0 : (i + 1) % count));
  }, [count]);
  const prev = useCallback(() => {
    setActiveIndex((i) => (count === 0 ? -1 : i < 0 ? count - 1 : (i - 1 + count) % count));
  }, [count]);
  const clear = useCallback(() => setQuery(""), []);

  const activeMatch = activeIndex >= 0 && activeIndex < count ? matches[activeIndex] : null;
  const highlightSlotKey = activeMatch?.kind === "placement" ? activeMatch.slotKey : null;
  const highlightSampleId = activeMatch?.kind === "backlog" ? activeMatch.sampleId : null;

  return {
    query,
    setQuery,
    q: trimmed,
    searchActive,
    matches,
    count,
    activeIndex,
    activeMatch,
    next,
    prev,
    clear,
    highlightSlotKey,
    highlightSampleId,
    backlogItems: searchActive ? backlogItemsRaw : null,
    backlogTotal: backlogQuery.data?.total ?? 0,
    backlogLoading: backlogQuery.isLoading,
    backlogUpdatedAt: backlogQuery.dataUpdatedAt,
  };
}

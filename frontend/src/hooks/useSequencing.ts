import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { sequencingApi } from "@/api/sequencing";

/** MLWH-backed reads. Each starts after its page has drawn and never holds it up; the backend
 * caches MLWH's answers (services/mlwh_wells.fetch), so these stale times only save round trips. */

const RUN_STALE_MS = 60_000;
const HISTORY_STALE_MS = 5 * 60_000;

/** A run's per-well results from MLWH - shared by the run page and its slot popovers. Only worth
 * asking once the run has started: a planned run has nothing in MLWH. */
export function useRunSequencing(runId: number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["run-sequencing", runId],
    queryFn: () => sequencingApi.run(runId as number),
    enabled: enabled && runId != null,
    staleTime: RUN_STALE_MS,
  });
}

/** Just a running run's SMRT Link URL (Instruments, Today). Those pages poll every minute, but a
 * URL never changes once known, so this stops asking then; until MLWH has the run it checks at
 * most every 5 minutes. Shares its cache with useRunSequencing. */
export function useRunSmrtLinkUrl(runId: number | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ["run-sequencing", runId],
    queryFn: () => sequencingApi.run(runId as number),
    enabled: runId != null,
    staleTime: (q) => (q.state.data?.smrt_link_url ? Infinity : HISTORY_STALE_MS),
    refetchInterval: (q) => (q.state.data?.smrt_link_url ? false : HISTORY_STALE_MS),
  });
  return data?.smrt_link_url ?? null;
}

/** Highlights for the samples on screen (a list page), keyed by sample id. */
export function useSequencingSummaries(sampleIds: number[]) {
  const ids = [...new Set(sampleIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["sequencing-history", ids],
    queryFn: () => sequencingApi.summaries(ids),
    enabled: ids.length > 0,
    staleTime: HISTORY_STALE_MS,
    // Keep the last page's answer while the next page's loads, so the column doesn't blink out.
    placeholderData: (previous) => previous,
  });
}

/** One sample's every loading - shared by the list pop-down, the sample page and the edit dialog. */
export function useSequencingHistory(sampleId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["sequencing-history", "sample", sampleId],
    queryFn: () => sequencingApi.history(sampleId as number),
    enabled: enabled && sampleId != null,
    staleTime: HISTORY_STALE_MS,
  });
}

/** A Refresh / Retry button for an MLWH-backed query: asks MLWH again (skipping RunNx's cache and
 * its pause after a failure) and puts the answer straight into the query. */
export function useMlwhRefresh<T>(queryKey: QueryKey, fetchFresh: () => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fetchFresh,
    onSuccess: (fresh) => queryClient.setQueryData(queryKey, fresh),
  });
}

/** Which rows of a table have their sequencing history dropped open (by id). */
export function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback(
    (id: number) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  return useMemo(() => ({ has: (id: number) => open.has(id), toggle }), [open, toggle]);
}

/** What a table's Sequenced column needs: the page's highlights, and which rows are open. Null
 * while it isn't known whether this deployment has MLWH, or when it hasn't - the column is then
 * left out rather than shown empty. */
export function useSequencedColumn(sampleIds: number[], openRows: ReturnType<typeof useOpenRows>) {
  const summaries = useSequencingSummaries(sampleIds);
  const data = summaries.data;
  return useMemo(() => {
    if (!data?.configured) return null;
    return {
      summaries: data.samples,
      state: (summaries.isPlaceholderData ? "loading" : data.ok ? "ok" : "error") as "loading" | "ok" | "error",
      error: data.error,
      openRows,
    };
  }, [data, summaries.isPlaceholderData, openRows]);
}

export type SequencedColumn = NonNullable<ReturnType<typeof useSequencedColumn>>;

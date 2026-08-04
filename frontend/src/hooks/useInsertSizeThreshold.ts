import { useQuery } from "@tanstack/react-query";

import { settingsApi } from "@/api/settings";

/** Built-in fallback mirroring the backend's DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP - used
 * until the admin-configured value loads (and if the query ever fails). */
export const DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP = 5000;

/** The admin-configured insert-size (bp) threshold: a library whose insert_size_bp is at/below
 * this counts as "small-insert" and is kept on a cell's first use (see the Admin "Scheduling"
 * panel). Cached once and shared across every card/flag via React Query, so a page full of
 * cards issues a single request. */
export function useInsertSizeThreshold(): number {
  const { data } = useQuery({
    queryKey: ["scheduling-settings"],
    queryFn: () => settingsApi.getScheduling(),
    staleTime: 5 * 60_000,
  });
  return data?.insert_size_reuse_threshold_bp ?? DEFAULT_INSERT_SIZE_REUSE_THRESHOLD_BP;
}

/** Short "<5kb"-style label for a bp threshold (5000 -> "<5kb", 4500 -> "<4.5kb"). The tag text
 * tracks the configured threshold so it never claims "<5kb" when the admin has changed it. */
export function thresholdLabel(thresholdBp: number): string {
  const kb = thresholdBp / 1000;
  const text = Number.isInteger(kb) ? String(kb) : kb.toFixed(1);
  return `<${text}kb`;
}

/** The user-facing warning shown when a small-insert sample is placed on a cell's 2nd/3rd use.
 * The kb figure tracks the configured threshold. */
export function smallInsertReuseWarning(thresholdBp: number): string {
  return `Samples ${thresholdLabel(thresholdBp)} have shown reduced performance of re-uses.`;
}

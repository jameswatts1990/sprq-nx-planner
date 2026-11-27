import type {
  RunSequencing,
  SequencingHistory,
  SequencingStats,
  SequencingSummaries,
} from "@/types/sequencing";

import { api, buildQuery } from "./client";

/** What MLWH recorded about RunNx's runs and samples. Every call resolves even when MLWH is unset
 * or down (configured / ok / error in the body). `refresh` - a Refresh or Retry button - asks MLWH
 * again instead of taking RunNx's cached answer (backend services/mlwh_wells.fetch). */
export const sequencingApi = {
  run: (runId: number, refresh = false) =>
    api.get<RunSequencing>(`/api/cycles/${runId}/sequencing${refresh ? "?refresh=true" : ""}`),
  /** Highlights for a page of samples (at most 200) - no loadings, so a list stays light. */
  summaries: (sampleIds: number[]) =>
    api.get<SequencingSummaries>(
      `/api/samples/sequencing-history?${sampleIds.map((id) => `sample_id=${id}`).join("&")}`,
    ),
  history: (sampleId: number, refresh = false) =>
    api.get<SequencingHistory>(`/api/samples/${sampleId}/sequencing-history${refresh ? "?refresh=true" : ""}`),
  stats: (params: { date_from?: string; date_to?: string; instrument_serial?: string }) =>
    api.get<SequencingStats>(`/api/stats/sequencing${buildQuery(params)}`),
};

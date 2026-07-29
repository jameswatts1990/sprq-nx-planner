import { api } from "./client";
import type { AutoFillRequest, AutoFillResponse, RecalculateRequest } from "@/types/schedulerGrid";

/** The batch auto-scheduler endpoint. Placement of individual samples goes through
 * cellUsesApi.place; this fills a set of selected empty (instrument, day) cells in one
 * shot per the current Run Design dials + objective. */
export const schedulerApi = {
  autoFill: (req: AutoFillRequest) => api.post<AutoFillResponse>("/api/auto-fill", req),
  /** Re-pack one instrument's not-yet-loaded placements from scratch under the current
   * engine rules - the "Recalculate" action next to its name in the weekly grid. */
  recalculate: (req: RecalculateRequest) => api.post<AutoFillResponse>("/api/auto-fill/recalculate", req),
};

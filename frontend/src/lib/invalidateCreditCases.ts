import type { QueryClient } from "@tanstack/react-query";

/**
 * A PacBio credit-stage change (case number, internal report, credit, owner, note) only touches
 * a case's credit fields - never a cell's status, uses, the schedule or samples - so it refreshes
 * just the lists that show credit cases: the cell lists/detail (QC page, Cells page QC chips, cell
 * detail tracker), the no-cell cases, Stats' credit funnel, the QC nav count and the QC Review
 * queue (logging or deleting a case without a cell takes its well out of / back into it). Using invalidateScheduleRelated
 * here refetched the whole schedule after every QC-page click.
 *
 * Bare ["cell"] alongside ["cells"] for the same reason as invalidateScheduleRelated: React Query
 * prefix-matches within one key shape, so the singular detail keys need their own entry.
 */
export function invalidateCreditCases(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["cells"] });
  void queryClient.invalidateQueries({ queryKey: ["cell"] });
  void queryClient.invalidateQueries({ queryKey: ["pacbio-cases"] });
  void queryClient.invalidateQueries({ queryKey: ["stats"] });
  void queryClient.invalidateQueries({ queryKey: ["qc-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["qc-review"] });
}

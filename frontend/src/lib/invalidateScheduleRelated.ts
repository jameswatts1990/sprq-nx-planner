import type { QueryClient } from "@tanstack/react-query";

/**
 * Any mutation that changes a cell's status/use history, a cycle's stages, or a sample's
 * status touches all three: cell status changes can bump samples back to the backlog and
 * alter what the schedule grid renders for that cycle, and vice versa. Several call sites
 * used to hand-roll a subset of these three invalidations and drifted out of sync with
 * each other - this is the single source of truth so that can't happen again.
 *
 * Includes the bare ["cell"]/["cycle"]/["sample"] singular prefixes alongside the plural
 * list keys - React Query only does prefix matching within an identical key array, so
 * invalidating ["cells"] never touches a ["cell", id] detail query cached under a
 * different id, and vice versa. Invalidating the bare singular prefix matches every
 * ["cell", *] entry regardless of which id a given page happens to be viewing.
 */
export function invalidateScheduleRelated(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["cycles"] });
  void queryClient.invalidateQueries({ queryKey: ["cycle"] });
  void queryClient.invalidateQueries({ queryKey: ["cells"] });
  void queryClient.invalidateQueries({ queryKey: ["cell"] });
  void queryClient.invalidateQueries({ queryKey: ["samples"] });
  void queryClient.invalidateQueries({ queryKey: ["sample"] });
}

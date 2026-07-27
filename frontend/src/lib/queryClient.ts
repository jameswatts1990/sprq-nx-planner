import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      // Don't refire every mounted query the instant the browser tab regains focus. The
      // Schedule page alone mounts ~8 queries (three of which page through every matching
      // cell), so the default focus-refetch produced a visible stall each time a lab tech
      // alt-tabbed back. Freshness is still covered by the 15s staleTime, the Schedule page's
      // own 60s poll, and the explicit invalidations every mutation fires.
      refetchOnWindowFocus: false,
    },
  },
});

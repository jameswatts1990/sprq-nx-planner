import { useQuery } from "@tanstack/react-query";

import { settingsApi } from "@/api/settings";

/** The lab's overdue limit for credit cases (Settings > QC & credits), in days - undefined until
 * it loads, so no case is flagged overdue against a guessed limit. */
export function useOverdueDays(): number | undefined {
  const { data } = useQuery({
    queryKey: ["qc-settings"],
    queryFn: () => settingsApi.getQc(),
    staleTime: 5 * 60_000,
  });
  return data?.overdue_days;
}

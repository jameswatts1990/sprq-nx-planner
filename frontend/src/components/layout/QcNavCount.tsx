import { useQuery } from "@tanstack/react-query";

import { qcApi, type QcSummary } from "@/api/qc";
import { Badge } from "@/components/ui/Badge";

/** A sample summary for the Help page, which renders the real badge. */
export const EXAMPLE_QC_SUMMARY: QcSummary = { needs_report: 2, awaiting_credit: 4, overdue: 2, total_action: 3 };

const needs = (n: number) => (n === 1 ? "needs" : "need");

function breakdown(summary: QcSummary): string {
  const n = summary.total_action;
  const parts = [`${summary.needs_report} ${needs(summary.needs_report)} a report`, `${summary.overdue} overdue`];
  return `${n} credit case${n === 1 ? "" : "s"} ${needs(n)} action: ${parts.join(", ")}`;
}

/** The red count on the QC & credits tab: credit cases the lab has to act on (not yet reported to
 * PacBio, or overdue - each case once). Nothing when there are none. */
export function QcNavCountBadge({ summary }: { summary: QcSummary }) {
  if (summary.total_action === 0) return null;
  return (
    // role="img" so the breakdown, not a bare number, becomes part of the tab link's name.
    <span role="img" aria-label={breakdown(summary)} title={breakdown(summary)}>
      <Badge tone="danger" compact>
        {summary.total_action}
      </Badge>
    </span>
  );
}

/** QcNavCountBadge fed by GET /api/qc/summary, refreshed every minute; credit and Cell QC changes
 * invalidate ["qc-summary"] so it also updates straight away. */
export function QcNavCount() {
  const { data } = useQuery({
    queryKey: ["qc-summary"],
    queryFn: qcApi.summary,
    refetchInterval: 60_000,
  });
  return data ? <QcNavCountBadge summary={data} /> : null;
}

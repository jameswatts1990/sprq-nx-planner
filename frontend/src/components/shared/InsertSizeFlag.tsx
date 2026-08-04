import { Badge } from "@/components/ui/Badge";
import { thresholdLabel, useInsertSizeThreshold } from "@/hooks/useInsertSizeThreshold";

/** A "[<5kb]" flag shown wherever a sample appears when its insert / fragment size is at or
 * below the admin-configured small-insert threshold. Renders nothing when the size isn't
 * recorded or is above the threshold, so callers can drop it in unconditionally (like
 * DuplicateBadge). Small-insert libraries lose yield on a cell's 2nd/3rd use, so Auto Schedule
 * keeps them on a first use and warns if one is manually placed on a reuse (see
 * docs/pacbio-sprq-nx-scheduling-reference.md). The tag text tracks the configured threshold. */
export function InsertSizeFlag({ sizeBp }: { sizeBp?: number | null }) {
  const threshold = useInsertSizeThreshold();
  if (sizeBp == null || sizeBp > threshold) return null;
  return (
    <span
      title={`Insert size ${sizeBp.toLocaleString()} bp (≤ ${threshold.toLocaleString()} bp): small-insert library. Kept on a cell's first use — small inserts show reduced yield on re-use.`}
    >
      <Badge tone="orange">{thresholdLabel(threshold)}</Badge>
    </span>
  );
}

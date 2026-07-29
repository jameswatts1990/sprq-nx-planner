import { Badge } from "@/components/ui/Badge";

/** A "1/3" marker shown on a sample wherever it appears when its Container ID is carried by
 * more than one sample (the same sample deliberately run across multiple cells). Renders
 * nothing for a one-off, so callers can drop it in unconditionally.
 *
 * Deliberately a distinct `purple` tone from the cell "Use 1/2/3" swatches and the priority
 * badges, and worded "1/3" (with a fuller tooltip) so it reads as "copy of this sample", not
 * "use of this cell". `index`/`total` come straight from SampleOut/StageOut's duplicate_* fields.
 *
 * `selfReuse` (only meaningful on a scheduled StageOut, not a bare backlog SampleOut) adds a
 * small ↻ to the badge when this copy is intentionally sharing a physical cell with an earlier
 * copy of the same Container ID (StageOut.duplicate_cell_reuse) - allowed, since it's the same
 * physical material either way, but worth showing at a glance rather than leaving it a silent
 * exception to the barcode-clash rule. */
export function DuplicateBadge({
  index,
  total,
  selfReuse = false,
}: {
  index?: number | null;
  total?: number | null;
  selfReuse?: boolean;
}) {
  if (index == null || total == null || total <= 1) return null;
  const title = selfReuse
    ? `Copy ${index} of ${total} — this Container ID appears on ${total} samples (including completed runs). The same sample is run across multiple SMRT cells. This copy shares a physical cell with an earlier copy of the same sample — allowed, since it's the same underlying material either way.`
    : `Copy ${index} of ${total} — this Container ID appears on ${total} samples (including completed runs). The same sample is run across multiple SMRT cells.`;
  return (
    <span title={title}>
      <Badge tone="purple">
        {index}/{total}
        {selfReuse ? " ↻" : ""}
      </Badge>
    </span>
  );
}

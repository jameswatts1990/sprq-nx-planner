import { Badge } from "@/components/ui/Badge";

/** A "1/3" marker shown on a sample wherever it appears when its Container ID is carried by
 * more than one sample (the same sample deliberately run across multiple cells). Renders
 * nothing for a one-off, so callers can drop it in unconditionally.
 *
 * Deliberately a distinct `purple` tone from the cell "Use 1/2/3" swatches and the priority
 * badges, and worded "1/3" (with a fuller tooltip) so it reads as "copy of this sample", not
 * "use of this cell". `index`/`total` come straight from SampleOut/StageOut's duplicate_* fields. */
export function DuplicateBadge({
  index,
  total,
}: {
  index?: number | null;
  total?: number | null;
}) {
  if (index == null || total == null || total <= 1) return null;
  return (
    <span
      title={`Copy ${index} of ${total} — this Container ID appears on ${total} samples (including completed runs). The same sample is run across multiple SMRT cells.`}
    >
      <Badge tone="purple">
        {index}/{total}
      </Badge>
    </span>
  );
}

import type { BadgeTone } from "@/components/ui/Badge";

import chipStyles from "./StatusChip.module.css";

export { chipStyles };

const TONE_CLASS: Partial<Record<BadgeTone, string>> = {
  success: chipStyles.success,
  danger: chipStyles.danger,
  warning: chipStyles.warning,
  orange: chipStyles.orange,
  info: chipStyles.info,
};

/** Classes for a status chip in `tone` - take the tone from the same status map as the matching
 * Badge. A tone with no chip colour reads neutral grey. `matched` rings it as a search hit. */
export function chipClass(tone: BadgeTone, matched = false): string {
  const classes = [chipStyles.chip, TONE_CLASS[tone] ?? chipStyles.neutral];
  if (matched) classes.push(chipStyles.matched);
  return classes.join(" ");
}

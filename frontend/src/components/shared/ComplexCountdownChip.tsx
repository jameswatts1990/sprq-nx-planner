import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { COMPLEX_REPEAT_WINDOW_DAYS, complexDaysLeft } from "@/utils/qcDisposition";

/** Blue while there's comfortable time, amber in the last two weeks, red in the last week and
 * once expired. Exported so the Help legend can quote the same bands. */
export const COMPLEX_COUNTDOWN_AMBER_DAYS = 14;
export const COMPLEX_COUNTDOWN_RED_DAYS = 7;

function tone(daysLeft: number): BadgeTone {
  if (daysLeft <= COMPLEX_COUNTDOWN_RED_DAYS) return "danger";
  if (daysLeft <= COMPLEX_COUNTDOWN_AMBER_DAYS) return "warning";
  return "blue";
}

/** Advisory countdown chip for a "Repeatable — from complex" sample: days left of the
 * 30-day leftover-complex window, counted from the date its Cell QC was recorded. A warning
 * only - nothing is blocked or changed on expiry. Renders nothing for any other sample. */
export function ComplexCountdownChip({
  qcDisposition,
  qcDispositionAt,
}: {
  qcDisposition: string | null;
  qcDispositionAt?: string | null;
}) {
  const daysLeft = complexDaysLeft(qcDisposition, qcDispositionAt);
  if (daysLeft == null || !qcDispositionAt) return null;
  const qcDate = new Date(qcDispositionAt).toLocaleDateString();
  const text = daysLeft >= 0 ? `Complex ${daysLeft}d left` : `Complex ${-daysLeft}d over`;
  return (
    <span
      title={`Repeat from complex: QC recorded ${qcDate}. Leftover complex is best used within ${COMPLEX_REPEAT_WINDOW_DAYS} days — this is a reminder only; nothing changes when it runs out.`}
    >
      <Badge tone={tone(daysLeft)}>⌛ {text}</Badge>
    </span>
  );
}

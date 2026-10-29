import { Badge } from "@/components/ui/Badge";
import { useMovieRules } from "@/hooks/useMovieRules";

/** A solid "12h"/"30h" label shown wherever a sample or well runs a movie time other than the
 * configured default (Settings > Movie scheduling, normally 24 h), so short and long runs stand
 * out at a glance. Renders nothing for a default-length (or unknown) movie, so callers can drop
 * it in unconditionally, like InsertSizeFlag. A plain fact, not a warning - nothing about a
 * non-default length is blocked. `compact` sizes it to the schedule card's cell line. */
export function MovieTimeFlag({ hours, compact = false }: { hours?: number | null; compact?: boolean }) {
  const { defaultHours, cellPosition } = useMovieRules();
  if (hours == null || hours === defaultHours) return null;
  const position = cellPosition[String(hours)];
  const title =
    `${hours} h movie (the default is ${defaultHours} h).` +
    (position != null ? ` Auto Schedule loads ${hours} h samples on cell ${position + 1}.` : "");
  return (
    <span title={title}>
      <Badge tone="ink" compact={compact}>
        {hours}h
      </Badge>
    </span>
  );
}

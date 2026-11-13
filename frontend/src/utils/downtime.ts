import type { DowntimeKind, DowntimeOut } from "@/types/instrument";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";

/** Instrument downtime periods, read on the client. Mirrors backend services/downtime.py: a
 * period covers start_date..end_date INCLUSIVE, end_date null = open-ended. ISO date strings
 * compare correctly as strings. The backend re-validates every gate; this only drives display. */

export const DOWNTIME_KIND_LABEL: Record<DowntimeKind, string> = {
  planned: "Planned",
  unplanned: "Unplanned",
};

export function downtimeOn(periods: readonly DowntimeOut[] | undefined, isoDate: string): DowntimeOut | null {
  return (
    periods?.find((p) => p.start_date <= isoDate && (p.end_date === null || isoDate <= p.end_date)) ?? null
  );
}

export function isDownOn(periods: readonly DowntimeOut[] | undefined, isoDate: string): boolean {
  return downtimeOn(periods, isoDate) !== null;
}

const short = (iso: string) => formatShortDateUTC(parseDateOnly(iso));

/** "12 Nov", "12–14 Nov", "28 Nov – 2 Dec", or "from 12 Nov" (open-ended). */
export function formatDowntimeSpan(period: Pick<DowntimeOut, "start_date" | "end_date">): string {
  const { start_date: start, end_date: end } = period;
  if (end === null) return `from ${short(start)}`;
  if (end === start) return short(start);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))}–${short(end)}`;
  return `${short(start)} – ${short(end)}`;
}

/** "Planned · 12–14 Nov" - a period at a glance (lists, tooltips). */
export function formatDowntime(period: DowntimeOut): string {
  return `${DOWNTIME_KIND_LABEL[period.kind]} · ${formatDowntimeSpan(period)}`;
}

/** A period's note without a trailing full stop, for splicing into a sentence ("…: Laser swap."). */
export function downtimeReason(period: Pick<DowntimeOut, "note">): string | null {
  return period.note?.trim().replace(/[.\s]+$/, "") || null;
}

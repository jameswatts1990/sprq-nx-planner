import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { addDaysUTC, parseDateOnly, toIsoDateUTC, todayIsoUTC } from "@/utils/calendarDates";

export const WINDOW_DAYS = 14;

export interface SchedulerWindow {
  /** YYYY-MM-DD anchor for the first column of the 14-day window. */
  from: string;
  /** The 14 YYYY-MM-DD day strings in the window. */
  days: string[];
  /** date_from / date_to for the cycles query (inclusive range). */
  dateFrom: string;
  dateTo: string;
  prev: () => void;
  next: () => void;
  goToday: () => void;
}

/**
 * Owns the URL-synced window anchor (`?from=YYYY-MM-DD`), replacing the old Plan page's
 * urlSettings mechanism. Defaults to today; prev/next page by 14 days. All date math
 * goes through the UTC-based calendarDates helpers.
 */
export function useSchedulerWindow(): SchedulerWindow {
  const [searchParams, setSearchParams] = useSearchParams();

  const fromParam = searchParams.get("from");
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : todayIsoUTC();

  const days = useMemo(() => {
    const start = parseDateOnly(from);
    return Array.from({ length: WINDOW_DAYS }, (_, i) => toIsoDateUTC(addDaysUTC(start, i)));
  }, [from]);

  const setFrom = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("from", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const shift = useCallback(
    (deltaDays: number) => {
      setFrom(toIsoDateUTC(addDaysUTC(parseDateOnly(from), deltaDays)));
    },
    [from, setFrom],
  );

  const prev = useCallback(() => shift(-WINDOW_DAYS), [shift]);
  const next = useCallback(() => shift(WINDOW_DAYS), [shift]);
  const goToday = useCallback(() => setFrom(todayIsoUTC()), [setFrom]);

  return {
    from,
    days,
    dateFrom: days[0],
    dateTo: days[days.length - 1],
    prev,
    next,
    goToday,
  };
}

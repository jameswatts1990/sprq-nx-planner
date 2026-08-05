import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { InstrumentOut } from "@/types/instrument";
import { addDaysUTC, formatShortDateUTC, mondayOfWeekUTC, parseDateOnly, todayIsoUTC, toIsoDateUTC } from "@/utils/calendarDates";

import { WeekPlanGantt } from "./WeekPlanGantt";
import { WEEK_PLAN_LOOKBACK_DAYS } from "./weekPlanTiming";
import styles from "./WeekPlanModal.module.css";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export interface WeekPlanModalProps {
  instrument: InstrumentOut;
  onClose: () => void;
}

/**
 * Full-screen "Week plan" for one instrument: fetches its current calendar week (plus a lookback
 * window so a run loaded just before Monday still renders correctly into it - see
 * weekPlanTiming.WEEK_PLAN_LOOKBACK_DAYS) and hands the result to WeekPlanGantt, which does all
 * the layout/timing work. Owns only the date-range math, the fetch, and the loading/empty/error
 * states around it.
 */
export function WeekPlanModal({ instrument, onClose }: WeekPlanModalProps) {
  const { monday, weekEnd, fromIso, toIso } = useMemo(() => {
    const mondayDate = mondayOfWeekUTC(parseDateOnly(todayIsoUTC()));
    const weekEndDate = addDaysUTC(mondayDate, 7);
    return {
      monday: mondayDate,
      weekEnd: weekEndDate,
      fromIso: toIsoDateUTC(addDaysUTC(mondayDate, -WEEK_PLAN_LOOKBACK_DAYS)),
      toIso: toIsoDateUTC(addDaysUTC(weekEndDate, -1)), // the visible week's Sunday
    };
  }, []);

  const weekPlanQuery = useQuery({
    // Keyed under ["cycles", …] so invalidateScheduleRelated refreshes it alongside every other
    // schedule mutation, same convention as InstrumentsPage's activeRunsQuery.
    queryKey: ["cycles", "week-plan", instrument.serial_number, fromIso, toIso],
    queryFn: () => cyclesApi.list({ instrument_serial: instrument.serial_number, date_from: fromIso, date_to: toIso }),
    refetchInterval: 60_000,
  });

  const rangeLabel = `${formatShortDateUTC(monday)} – ${formatShortDateUTC(addDaysUTC(weekEnd, -1))}`;

  return (
    <Modal
      onClose={onClose}
      title={`Week plan · ${instrument.name || instrument.serial_number}`}
      titleExtra={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
      fullScreen
    >
      <p className={styles.range}>{rangeLabel} · current week</p>

      {weekPlanQuery.isLoading && <div className={styles.status}>Loading this week's schedule…</div>}
      {weekPlanQuery.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(weekPlanQuery.error, "Couldn't load this week's schedule.")}
        </Note>
      )}
      {weekPlanQuery.data && (
        <>
          {weekPlanQuery.data.length === 0 && (
            <Note tone="info" icon="ℹ">
              Nothing scheduled on this instrument this week — the loading window is open all week.
            </Note>
          )}
          <WeekPlanGantt runs={weekPlanQuery.data} weekStartMs={monday.getTime()} weekEndMs={weekEnd.getTime()} />
        </>
      )}
    </Modal>
  );
}

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { todayIsoUTC } from "@/utils/calendarDates";

import {
  BacklogTodayCard,
  DayNotesCard,
  ExpiringTraysCard,
  InstrumentsTodayCard,
  LoadingTodayCard,
  QcTodayCard,
} from "./TodayCards";
import styles from "./TodayPage.module.css";
import { TODAY_REFRESH_MS, formatTodayHeading } from "./todayView";

/** Today's date, re-read every minute so a page left open overnight rolls over to the new day. */
function useTodayIso(): string {
  const [today, setToday] = useState(todayIsoUTC);
  useEffect(() => {
    const timer = setInterval(() => setToday(todayIsoUTC()), TODAY_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return today;
}

/** The landing page: what needs attention today, each card read from the page it summarises
 * (and linking there) and refreshed every minute. */
export function TodayPage() {
  const today = useTodayIso();
  return (
    <div className={styles.page}>
      <PageHeader help="today" title="Today" intro={`${formatTodayHeading(today)} · refreshes every minute`} />
      <div className={styles.grid}>
        <LoadingTodayCard today={today} />
        <InstrumentsTodayCard today={today} />
        <ExpiringTraysCard />
        <BacklogTodayCard />
        <QcTodayCard />
        <DayNotesCard today={today} />
      </div>
    </div>
  );
}

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cellsApi } from "@/api/cells";
import { errorMessage } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { qcApi } from "@/api/qc";
import { samplesApi } from "@/api/samples";
import { scheduleNotesApi } from "@/api/scheduleNotes";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { SmrtLinkLink } from "@/components/shared/SmrtLinkLink";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { useRunSmrtLinkUrl } from "@/hooks/useSequencing";
import type { InstrumentOut, InstrumentStatsOut } from "@/types/instrument";
import { formatDateTime, formatShortDateTimeLocal, formatShortDateUTC, formatTimeLocal, parseDateOnly } from "@/utils/calendarDates";
import { CYCLE_STATUS_TONE, RUN_STATUS_LABEL } from "@/utils/cycleStatus";
import { INSTRUMENT_STATUS_LABEL, INSTRUMENT_STATUS_TONE, instrumentStatus } from "@/utils/instrumentStatus";
import { formatHoursLeft } from "@/utils/openTrays";
import { ABORTED_PRIORITY, HIGH_PRIORITY } from "@/utils/priority";
import { runLabel } from "@/utils/runLabel";
import { EXPIRY_WARN_HOURS } from "@/utils/windowFade";

import styles from "./TodayPage.module.css";
import {
  TODAY_REFRESH_MS,
  downtimeLine,
  expiringTrays,
  instrumentLabel,
  loadedAt,
  oldestReviewDays,
  runsLoadingToday,
  wellCount,
} from "./todayView";

/** A Today card: title, an optional link to the page it summarises, and its body. */
function TodayCard({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        badge={
          link && (
            <Link className="link" to={link.to}>
              {link.label} →
            </Link>
          )
        }
      >
        <h2>{title}</h2>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** "Loading…" or the error for a card's query; null once its data is in. */
function QueryStatus({ query, what }: { query: UseQueryResult<unknown>; what: string }) {
  if (query.isLoading) return <div className="status sm">Loading…</div>;
  if (query.isError) return <Note tone="bad" icon="!">{errorMessage(query.error, `Couldn't load ${what}.`)}</Note>;
  return null;
}

const shortDate = (iso: string) => formatShortDateUTC(parseDateOnly(iso));

/** Active instruments, shared by the cards that name one (the Schedule's own key, so its cache is shared). */
function useActiveInstruments() {
  return useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
    refetchInterval: TODAY_REFRESH_MS,
  });
}

export function LoadingTodayCard({ today }: { today: string }) {
  const runsQuery = useQuery({
    // The Batch Sheet picker's key for one day, so the two share a cache.
    queryKey: ["cycles", { date_from: today, date_to: today }],
    queryFn: () => cyclesApi.list({ date_from: today, date_to: today }),
    refetchInterval: TODAY_REFRESH_MS,
  });
  const instruments = useActiveInstruments().data ?? [];
  const runs = runsLoadingToday(runsQuery.data ?? []);

  return (
    <TodayCard
      title="Loading today"
      link={runs.length > 0 ? { to: `/batch-sheet?date=${today}`, label: "Batch Sheet" } : undefined}
    >
      <QueryStatus query={runsQuery} what="today's runs" />
      {runsQuery.data && runs.length === 0 && <div className="status sm">No runs load today.</div>}
      {runs.length > 0 && (
        <ul className={styles.list}>
          {runs.map((run) => {
            const loaded = loadedAt(run);
            const wells = wellCount(run);
            return (
              <li key={run.run_id} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link className="link" to={`/history/runs/${run.run_id}`}>
                    {runLabel(run)}
                  </Link>{" "}
                  <span className={styles.muted}>
                    · {instrumentLabel(run.instrument_serial, instruments)} · {wells} well{wells === 1 ? "" : "s"}
                  </span>{" "}
                  <CellTypeBadge cellType={run.cell_type} compact />
                </div>
                <div className={styles.rowSide}>
                  <span className={loaded ? styles.loaded : styles.muted}>
                    {loaded ? `✓ Loaded ${formatTimeLocal(loaded)}` : run.status === "planned" ? "Not loaded yet" : ""}
                  </span>
                  <Badge tone={CYCLE_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </TodayCard>
  );
}

export function InstrumentsTodayCard({ today }: { today: string }) {
  const instrumentsQuery = useActiveInstruments();
  const statsQuery = useQuery({
    queryKey: ["instrument-stats"],
    queryFn: () => instrumentsApi.stats(),
    refetchInterval: TODAY_REFRESH_MS,
  });
  const instruments = instrumentsQuery.data ?? [];
  const statsBySerial = new Map((statsQuery.data ?? []).map((s) => [s.serial_number, s]));

  return (
    <TodayCard title="Instruments" link={{ to: "/instruments", label: "Instruments" }}>
      <QueryStatus query={instrumentsQuery} what="the instruments" />
      {instrumentsQuery.data && instruments.length === 0 && <div className="status sm">No active instruments.</div>}
      {instruments.length > 0 && (
        <ul className={styles.list}>
          {instruments.map((instrument) => (
            <InstrumentRow
              key={instrument.id}
              instrument={instrument}
              stats={statsBySerial.get(instrument.serial_number)}
              today={today}
            />
          ))}
        </ul>
      )}
    </TodayCard>
  );
}

function InstrumentRow({
  instrument,
  stats,
  today,
}: {
  instrument: InstrumentOut;
  stats: InstrumentStatsOut | undefined;
  today: string;
}) {
  const status = instrumentStatus(instrument);
  const downtime = downtimeLine(instrument, today);
  const smrtLinkUrl = useRunSmrtLinkUrl(stats?.running_run_id);
  return (
    <li className={styles.instrument}>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <b>{instrument.name || `Revio ${instrument.serial_number}`}</b>{" "}
          <Badge tone={INSTRUMENT_STATUS_TONE[status]}>{INSTRUMENT_STATUS_LABEL[status]}</Badge>
        </div>
        <div className={`${styles.rowSide} ${styles.muted}`}>
          {stats?.next_run_date ? `Next run ${shortDate(stats.next_run_date)}` : "No run booked"}
        </div>
      </div>
      <div className={styles.muted}>
        {stats?.running_run_name ? (
          <>
            Running{" "}
            {stats.running_run_id != null ? (
              <Link className="link" to={`/history/runs/${stats.running_run_id}`}>
                {stats.running_run_name}
              </Link>
            ) : (
              stats.running_run_name
            )}
            {stats.free_at ? ` · frees ${formatShortDateTimeLocal(stats.free_at)}` : ""}
            {smrtLinkUrl && (
              <>
                {" · "}
                <SmrtLinkLink url={smrtLinkUrl} label="SMRT Link" />
              </>
            )}
          </>
        ) : (
          "Idle"
        )}
      </div>
      {downtime && (
        <Note tone={downtime.tone} icon={downtime.tone === "warn" ? "!" : "i"} size="sm">
          {downtime.text}
        </Note>
      )}
    </li>
  );
}

export function ExpiringTraysCard() {
  // Open trays soonest-closing first (the Cells page's default order); the warning cut is client-side.
  const params = { status: "open", sort_by: "expiry", sort_dir: "asc", page: 1, page_size: 50 } as const;
  const traysQuery = useQuery({
    queryKey: ["cells", "trays", params],
    queryFn: () => cellsApi.listTrays(params),
    refetchInterval: TODAY_REFRESH_MS,
  });
  const trays = expiringTrays(traysQuery.data?.items ?? [], EXPIRY_WARN_HOURS);
  const more = !!traysQuery.data && trays.length === traysQuery.data.items.length && traysQuery.data.total > trays.length;

  return (
    <TodayCard title="Trays expiring" link={{ to: "/cells?status=open&sort=expiry&dir=asc", label: "Cells" }}>
      <QueryStatus query={traysQuery} what="the open trays" />
      {traysQuery.data && trays.length === 0 && (
        <div className="status sm">No tray&apos;s 108-hour window closes in the next {EXPIRY_WARN_HOURS} hours.</div>
      )}
      {trays.length > 0 && (
        <ul className={styles.list}>
          {trays.map((tray) => (
            <li key={tray.tray_id ?? `cell-${tray.cells[0]?.id}`} className={styles.row}>
              <div className={styles.rowMain}>
                <Link className="link" to={tray.tray_id !== null ? `/cells?tray=${tray.tray_id}` : `/cells/${tray.cells[0]?.id}`}>
                  {tray.tray_id !== null ? `Tray ${tray.tray_id}` : tray.cells[0]?.code}
                </Link>{" "}
                <span className={styles.muted}>
                  · Revio {tray.instrument_serial ?? "—"} · {tray.uses_left} use{tray.uses_left === 1 ? "" : "s"} left
                </span>
              </div>
              <div className={styles.rowSide}>
                {tray.expires_at && <span className={styles.muted}>closes {formatDateTime(tray.expires_at)}</span>}
                <Badge tone="warning">{formatHoursLeft(tray.expires_in_hours ?? 0)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && <div className="status sm">More trays close soon — see Cells for the full list.</div>}
    </TodayCard>
  );
}

/** One backlog count (page_size 1, reading total) with the Backlog main list's own filters, so the
 * number matches the list a click opens. */
function useBacklogCount(priority?: string) {
  const params = { status: "backlog", qc_disposition: "none", priority, page: 1, page_size: 1 };
  return useQuery({
    queryKey: ["samples", params],
    queryFn: () => samplesApi.list(params),
    refetchInterval: TODAY_REFRESH_MS,
  });
}

export function BacklogTodayCard() {
  const allQuery = useBacklogCount();
  const highQuery = useBacklogCount(HIGH_PRIORITY);
  const abortedQuery = useBacklogCount(ABORTED_PRIORITY);
  const waiting = allQuery.data?.total ?? 0;
  const high = highQuery.data?.total ?? 0;
  const aborted = abortedQuery.data?.total ?? 0;
  const loaded = allQuery.data && highQuery.data && abortedQuery.data;
  const count = (n: number, priority: string) =>
    n > 0 ? (
      <Link className={styles.statLink} to={`/backlog?priority=${encodeURIComponent(priority)}`}>
        {n}
      </Link>
    ) : (
      0
    );

  return (
    <TodayCard title="Backlog" link={{ to: "/backlog", label: "Backlog" }}>
      <QueryStatus query={allQuery} what="the backlog" />
      {loaded && (
        <>
          <StatTiles>
            <StatTile label="Waiting" value={waiting} title="Samples waiting to be scheduled" />
            <StatTile label="High priority" value={count(high, HIGH_PRIORITY)} />
            <StatTile label="Aborted" value={count(aborted, ABORTED_PRIORITY)} title="Sent back by a stopped cell" />
          </StatTiles>
          {high + aborted === 0 && (
            <div className="status sm">
              {waiting === 0 ? "The backlog is empty." : "Nothing high-priority or aborted is waiting."}
            </div>
          )}
        </>
      )}
    </TodayCard>
  );
}

export function QcTodayCard() {
  // The QC nav count's key, so the card and the chip always agree.
  const qcQuery = useQuery({ queryKey: ["qc-summary"], queryFn: qcApi.summary, refetchInterval: TODAY_REFRESH_MS });
  const summary = qcQuery.data;

  return (
    <TodayCard title="QC & credits" link={{ to: "/qc", label: "QC & credits" }}>
      <QueryStatus query={qcQuery} what="the QC summary" />
      {summary && (
        <>
          <StatTiles>
            <StatTile label="Needs report" value={summary.needs_report} title="Failed cells not yet reported to PacBio" />
            <StatTile label="Overdue" value={summary.overdue} title="Open cases past the overdue limit in Settings" />
            <StatTile
              label="Awaiting credit"
              value={summary.awaiting_credit}
              title="Reported to PacBio, credit not yet received"
            />
          </StatTiles>
          {summary.total_action === 0 && (
            <div className="status sm">Nothing needs a report and nothing is overdue.</div>
          )}
        </>
      )}
    </TodayCard>
  );
}

/** QC Review's queue: SMRT cells the QC team failed in LangQC (MLWH) that RunNx hasn't failed yet.
 * Reads the QC page's own key, so the two share a cache and a Confirm fail / Ignore there updates
 * this card too. MLWH unset or down reads as a line in the card, never a broken page. */
export function QcReviewTodayCard() {
  const reviewQuery = useQuery({ queryKey: ["qc-review"], queryFn: () => qcApi.review(), refetchInterval: TODAY_REFRESH_MS });
  const review = reviewQuery.data;
  const waiting = review?.pending.length ?? 0;
  const oldest = review ? oldestReviewDays(review.pending, reviewQuery.dataUpdatedAt) : null;

  return (
    <TodayCard title="QC Review" link={{ to: "/qc", label: "QC & credits" }}>
      <QueryStatus query={reviewQuery} what="QC Review" />
      {review && !review.configured && (
        <div className="status sm">Needs the MLWH connection, which this deployment doesn&apos;t have.</div>
      )}
      {review?.configured && !review.ok && (
        <Note tone="bad" icon="!">
          Couldn&apos;t read the QC team&apos;s verdicts from MLWH{review.error ? `: ${review.error}` : "."}
        </Note>
      )}
      {review?.ok && (
        <>
          <StatTiles>
            <StatTile
              label="To review"
              value={
                waiting > 0 ? (
                  <Link className={styles.statLink} to="/qc">
                    {waiting}
                  </Link>
                ) : (
                  0
                )
              }
              title="SMRT cells the QC team failed in LangQC (SMRT cell or instrument) that RunNx hasn't failed yet"
            />
            <StatTile
              label="Oldest"
              value={oldest === null ? "—" : `${oldest} d`}
              title="Days since LangQC signed off the oldest well still waiting"
            />
          </StatTiles>
          {waiting === 0 && (
            <div className="status sm">
              Nothing to review: every SMRT cell the QC team failed since{" "}
              {formatShortDateUTC(parseDateOnly(review.since))} is already in RunNx.
            </div>
          )}
        </>
      )}
    </TodayCard>
  );
}

export function DayNotesCard({ today }: { today: string }) {
  const notesQuery = useQuery({
    queryKey: ["schedule-notes", { date_from: today, date_to: today }],
    queryFn: () => scheduleNotesApi.list({ date_from: today, date_to: today }),
    refetchInterval: TODAY_REFRESH_MS,
  });
  const instruments = useActiveInstruments().data ?? [];
  const notes = notesQuery.data ?? [];

  return (
    <TodayCard title="Day notes" link={{ to: `/schedule?from=${today}`, label: "Schedule" }}>
      <QueryStatus query={notesQuery} what="today's notes" />
      {notesQuery.data && notes.length === 0 && <div className="status sm">No day notes for today.</div>}
      {notes.length > 0 && (
        <ul className={styles.list}>
          {notes.map((note) => (
            <li key={note.id} className={styles.note}>
              <Note tone="info" icon="i" size="sm">
                {note.body}
              </Note>
              <div className={styles.muted}>
                {note.instrument_serials.map((s) => instrumentLabel(s, instruments)).join(", ")}
                {note.created_by ? ` · ${note.created_by}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </TodayCard>
  );
}

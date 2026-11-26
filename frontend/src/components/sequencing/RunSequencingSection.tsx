import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { sequencingApi } from "@/api/sequencing";
import { MlwhErrorNote } from "@/components/shared/MlwhErrorNote";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { useMlwhRefresh } from "@/hooks/useSequencing";
import type { RunOut } from "@/types/schedule";
import type { RunSequencing, RunSequencingWell, SequencingFlag } from "@/types/sequencing";
import { formatShortDateTimeLocal } from "@/utils/calendarDates";
import { plateWellFromPlate } from "@/utils/plateWell";
import { useSampleBackNav } from "@/utils/sampleBackNav";
import { formatGb, formatMovie, formatPct, formatPm, langQcLabel, langQcTone } from "@/utils/sequencing";

import styles from "./RunSequencingSection.module.css";

export function FlagBadges({ flags }: { flags: SequencingFlag[] }) {
  return (
    <>
      {flags.map((f) => (
        // "Not in RunNx" reads in QC Review's orange; a disagreement with the plan is a warning.
        <Badge key={f.kind} tone={f.kind === "not_in_plan" ? "orange" : "warning"} title={f.detail}>
          {f.label}
        </Badge>
      ))}
    </>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className={styles.sub}>{children}</span>;
}

function WellRow({ row }: { row: RunSequencingWell }) {
  const backNav = useSampleBackNav();
  const m = row.mlwh;
  const ran = m?.well_start
    ? `${formatShortDateTimeLocal(m.well_start)}${m.well_complete ? ` → ${formatShortDateTimeLocal(m.well_complete)}` : ""}`
    : null;
  return (
    <tr>
      <td className={styles.mono}>{plateWellFromPlate(row.plate_number, row.well, { qualified: true })}</td>
      <td>
        {row.cell_id != null && row.cell_code ? (
          <Link to={`/cells/${row.cell_id}`} className={`link ${styles.mono}`}>
            {row.cell_code}
          </Link>
        ) : (
          "—"
        )}
        {row.use_number != null && <span className={styles.use}> · Use {row.use_number}</span>}
        {m?.smrt_cell_id && (
          <Sub>
            SMRT cell {m.smrt_cell_id}
            {m.cell_lot ? ` · lot ${m.cell_lot}` : ""}
          </Sub>
        )}
      </td>
      <td>
        {row.sample_id != null && row.pool_id ? (
          <Link to={`/samples/${row.sample_id}`} state={backNav} className="link">
            {row.pool_id}
          </Link>
        ) : (
          (m?.library_barcodes.join(", ") ?? "—")
        )}
        {m && m.sample_count > 1 && <Sub>pool of {m.sample_count}</Sub>}
      </td>
      <td>
        {m ? (
          <Badge tone={langQcTone(m.qc_state)} title="LangQC's verdict on this well, from MLWH">
            {langQcLabel(m.qc_state)}
          </Badge>
        ) : (
          <span className={styles.muted} title="SMRT Link hasn't reported this well to MLWH yet">
            Not in MLWH yet
          </span>
        )}
        {m?.run_status && /abort|terminat/i.test(m.run_status) && <Sub>Run {m.run_status.toLowerCase()}</Sub>}
      </td>
      <td className={styles.num}>
        {formatGb(m?.hifi_yield_gb) ?? "—"}
        {m?.hifi_read_length_kb != null && <Sub>{m.hifi_read_length_kb} kb reads</Sub>}
      </td>
      <td className={styles.num} title="P1 loading: the share of ZMWs that took exactly one molecule">
        {formatPct(m?.p1_pct) ?? "—"}
      </td>
      <td className={styles.num}>
        {formatPm(m?.loading_conc) ?? "—"}
        {row.planned_oplc != null && <Sub>plan {formatPm(row.planned_oplc)}</Sub>}
      </td>
      <td className={styles.num}>
        {formatMovie(m?.movie_minutes) ?? "—"}
        {row.planned_hours != null && m?.movie_minutes != null && <Sub>plan {row.planned_hours} h</Sub>}
      </td>
      <td className={styles.ran}>{ran ?? "—"}</td>
      <td>
        <span className={styles.flags}>
          <FlagBadges flags={row.flags} />
        </span>
      </td>
    </tr>
  );
}

/**
 * "Sequencing results" on a run's page: each well as MLWH recorded it (LangQC verdict, HiFi
 * yield, P1 loading, the loading concentration and movie SMRT Link actually used) beside the plan,
 * with a warning badge wherever the two disagree. Read from MLWH on request - nothing is copied
 * into RunNx - and only once the run has started. See backend services/run_sequencing.py.
 */
export function RunSequencingSection({ run, results }: { run: RunOut; results: UseQueryResult<RunSequencing> }) {
  const refresh = useMlwhRefresh(["run-sequencing", run.run_id], () => sequencingApi.run(run.run_id, true));
  if (run.status === "planned") return null;
  const data = results.data;
  const found = data?.ok && data.matched_by != null;

  const legend = data?.ok ? (
    <span className={styles.legend}>
      {data.matched_by === "instrument_date" && (
        <Badge
          tone="warning"
          title="This run has no Traction run name, so its wells were matched by instrument and load day. Check they're the right ones."
        >
          Matched by instrument &amp; date
        </Badge>
      )}
      <span className={styles.muted}>from MLWH</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        title="Ask MLWH again now (results are otherwise re-read at most once a minute)"
      >
        {refresh.isPending ? "Refreshing…" : "Refresh"}
      </Button>
    </span>
  ) : undefined;

  return (
    <section aria-label="Sequencing results">
      <SectionHeading title="Sequencing results" legend={legend} />
      {results.isLoading && <div className="status sm">Reading this run&apos;s results from MLWH…</div>}
      {results.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(results.error, "Couldn't load this run's results.")}
        </Note>
      )}
      {data && !data.configured && (
        <p className={styles.intro}>
          Sequencing results aren&apos;t available here: this deployment has no MLWH connection, so RunNx can&apos;t see
          what SMRT Link recorded.
        </p>
      )}
      {data?.configured && !data.ok && (
        <MlwhErrorNote
          what="this run's results"
          error={data.error}
          onRetry={() => refresh.mutate()}
          retrying={refresh.isPending}
        />
      )}
      {data?.ok && !found && (
        <p className={styles.intro}>
          MLWH has no record of {run.run_name ?? "this run"} yet - results appear here once SMRT Link reports it.
          {!run.run_name &&
            " This run has no Traction run name, so RunNx looks for it by instrument and load day; adding the name (at Confirm loaded) makes the match certain."}
        </p>
      )}
      {found && (
        <div className={styles.tableWrap}>
          <table className="table">
            <thead>
              <tr>
                <th>Well</th>
                <th>Cell</th>
                <th>Pool ID</th>
                <th>LangQC</th>
                <th>HiFi yield</th>
                <th>P1</th>
                <th>Loading</th>
                <th>Movie</th>
                <th>Ran</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {data.wells.map((row) => (
                <WellRow key={row.key} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

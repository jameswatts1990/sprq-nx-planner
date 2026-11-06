import { memo } from "react";
import { Link } from "react-router-dom";

import type { RunHistorySortKey } from "@/api/cycles";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { UseBox } from "@/components/cells/UseBox";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { RowToggle, useRowToggles } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/Badge";
import type { CellType } from "@/types/common";
import type { RunHistoryRowOut, RunHistoryWellOut } from "@/types/schedule";
import { formatDateTime, formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { CYCLE_STATUS_TONE, RUN_STATUS_LABEL } from "@/utils/cycleStatus";
import type { SortDir } from "@/utils/listView";
import { runLabel } from "@/utils/runLabel";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";
import { cellUseStatusLabel, USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./RunHistoryTable.module.css";
import { RunWellStrip } from "./RunWellStrip";

const COLUMN_COUNT = 9;

export interface RunHistoryTableProps {
  rows: RunHistoryRowOut[];
  sort: { by: RunHistorySortKey; dir: SortDir; onSort: (key: RunHistorySortKey) => void };
  /** Rows start expanded (a search with one hit); a click still toggles. */
  defaultExpanded: boolean;
  /** Ring the wells a search matched. */
  highlightMatches: boolean;
  /** Router state for every run / cell / sample link, so their Back returns here. */
  linkState: SampleDetailLocationState;
  /** Dim the rows while the next page / filter loads over them. */
  updating: boolean;
}

/** The Run history table: one row per run - name, load date, instrument, chemistry, status, a
 * chip per well, movie and load time - expanding to each well's cell, sample and outcome. */
export function RunHistoryTable({ rows, sort, defaultExpanded, highlightMatches, linkState, updating }: RunHistoryTableProps) {
  const { isExpanded, onToggle } = useRowToggles(defaultExpanded);

  const header = (label: string, key: RunHistorySortKey) => (
    <SortableColumnHeader label={label} active={sort.by === key} dir={sort.dir} onClick={() => sort.onSort(key)} />
  );

  return (
    <div className={list.tableWrap}>
      <table className={`table ${list.table} ${updating ? list.updating : ""}`}>
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>{header("Run", "run")}</th>
            <th>{header("Load date", "load_date")}</th>
            <th>{header("Instrument", "instrument")}</th>
            <th>Chemistry</th>
            <th>Status</th>
            <th>Wells</th>
            <th>Movie</th>
            <th>Loaded at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RunRow
              key={row.run_id}
              row={row}
              expanded={isExpanded(row.run_id)}
              onToggle={onToggle}
              highlightMatches={highlightMatches}
              linkState={linkState}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RunRowProps {
  row: RunHistoryRowOut;
  expanded: boolean;
  /** One stable handler for every row, so this memoized row only re-renders when its own data
   * or open state changes. */
  onToggle: (runId: number) => void;
  highlightMatches: boolean;
  linkState: SampleDetailLocationState;
}

const RunRow = memo(function RunRow({ row, expanded, onToggle, highlightMatches, linkState }: RunRowProps) {
  const matched = highlightMatches ? new Set(row.matched_use_ids) : undefined;
  const label = runLabel(row);

  return (
    <>
      <tr className={list.row} onClick={() => onToggle(row.run_id)}>
        <RowToggle expanded={expanded} label={`run ${label}'s wells`} />
        <td className={list.nowrap}>
          <Link
            to={`/history/runs/${row.run_id}`}
            state={linkState}
            className={`link ${list.mono}`}
            onClick={(e) => e.stopPropagation()}
            title="Open this run's page"
          >
            {label}
          </Link>
        </td>
        <td className={list.nowrap}>{formatDateUTC(parseDateOnly(row.load_date))}</td>
        <td className={list.mono}>{row.instrument_serial}</td>
        <td>{row.cell_type === "sprq" ? <CellTypeBadge cellType="sprq" /> : "SPRQ-Nx"}</td>
        <td>
          <Badge tone={CYCLE_STATUS_TONE[row.status]}>{RUN_STATUS_LABEL[row.status]}</Badge>
        </td>
        <td>
          <RunWellStrip wells={row.wells} matchedIds={matched} linkState={linkState} />
        </td>
        <td className={list.nowrap}>{row.movie_hours !== null ? `${row.movie_hours} h` : "—"}</td>
        <td className={list.nowrap}>
          {row.loaded_at ? (
            <>
              {formatDateTime(row.loaded_at)}
              {!row.loaded && (
                <span className={styles.sub} title="Not loaded yet - this is its planned start">
                  planned
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMN_COUNT} className={list.detailCell}>
            {row.wells.length === 0 ? (
              <div className="status sm">Nothing is loaded on this run.</div>
            ) : (
              <RunWells wells={row.wells} cellType={row.cell_type} matched={matched} linkState={linkState} />
            )}
          </td>
        </tr>
      )}
    </>
  );
});

/** The expanded run: each well with its cell (and which use of it), sample, barcodes, outcome
 * and times. */
function RunWells({
  wells,
  cellType,
  matched,
  linkState,
}: {
  wells: RunHistoryWellOut[];
  cellType: CellType;
  matched: ReadonlySet<number> | undefined;
  linkState: SampleDetailLocationState;
}) {
  return (
    <table className={`table ${list.innerTable}`}>
      <thead>
        <tr>
          <th>Well</th>
          <th>Cell</th>
          <th>Sample</th>
          <th>Barcodes</th>
          <th>Status</th>
          <th>Started</th>
          <th>Completed</th>
        </tr>
      </thead>
      <tbody>
        {wells.map((w) => (
          <tr key={w.cell_use_id} className={matched?.has(w.cell_use_id) ? list.matchedRow : undefined}>
            <td className={`${list.mono} ${list.nowrap}`}>
              P{w.plate_index} · {w.well}
            </td>
            <td className={list.nowrap}>
              <span className={styles.cell}>
                <UseBox use={w.use_number} cellType={cellType} />
                <Link to={`/cells/${w.cell_id}`} state={linkState} className={`link ${list.mono}`}>
                  {w.cell_code}
                </Link>
              </span>
            </td>
            <td>
              {w.sample_id !== null && w.sample_pool_id !== null ? (
                <Link to={`/samples/${w.sample_id}`} state={linkState} className="link">
                  {w.sample_pool_id}
                </Link>
              ) : (
                <span className={list.faint}>no sample</span>
              )}
            </td>
            <td>{w.barcodes.length > 0 ? <BarcodeChips barcodes={w.barcodes} /> : "—"}</td>
            <td>
              <Badge tone={USE_STATUS_TONE[w.status] ?? "default"}>{cellUseStatusLabel(w.status)}</Badge>
            </td>
            <td className={list.nowrap}>{w.started_at ? formatDateTime(w.started_at) : "—"}</td>
            <td className={list.nowrap}>{w.completed_at ? formatDateTime(w.completed_at) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

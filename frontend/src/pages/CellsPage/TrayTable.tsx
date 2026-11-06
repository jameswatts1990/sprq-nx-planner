import type { MouseEvent } from "react";
import { memo } from "react";
import { Link } from "react-router-dom";

import type { TraySortKey } from "@/api/cells";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { TrayActions } from "@/components/cells/TrayActions";
import { TrayCellStrip } from "@/components/cells/TrayCellStrip";
import { UseBox } from "@/components/cells/UseBox";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { RowToggle, useRowToggles } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/Badge";
import type { CellOut, CellTrayRowOut } from "@/types/cell";
import { formatDateTime, formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { CELL_QC_FLAG_LABEL, CELL_QC_FLAG_TONE } from "@/utils/cellQcFlag";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE, discardedWithUsesLeft } from "@/utils/cellStatus";
import type { SortDir } from "@/utils/listView";
import { formatHoursLeft, windowHoursRemaining } from "@/utils/openTrays";
import { runLabel } from "@/utils/runLabel";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";
import { cellUseStatusLabel, USE_STATUS_TONE } from "@/utils/useStatusTone";
import { EXPIRY_WARN_HOURS } from "@/utils/windowFade";

import styles from "./TrayTable.module.css";

const COLUMN_COUNT = 10;

export interface TrayTableSort {
  by: TraySortKey;
  dir: SortDir;
  onSort: (key: TraySortKey) => void;
}

export interface TrayTableProps {
  rows: CellTrayRowOut[];
  /** Column-header sorting; omit for a fixed single-tray table. */
  sort?: TrayTableSort;
  /** Rows start expanded (the single-tray view, or a search with one hit); a click still toggles. */
  defaultExpanded?: boolean;
  /** Ring the cells a search matched. */
  highlightMatches?: boolean;
  /** Router state for every cell / sample / tray link, so their Back returns here. */
  linkState: SampleDetailLocationState;
  /** Dim the rows while the next page / filter loads over them. */
  updating?: boolean;
}

function rowKey(row: CellTrayRowOut): string {
  return row.tray_id !== null ? `tray-${row.tray_id}` : `cell-${row.cells[0]?.id}`;
}

/** The Cells page's table: one row per physical tray - tray, chemistry, instrument, a status chip
 * per cell, uses left, first use, last run and when its 108h window closes - expanding to the
 * tray's cells and the tray-wide actions. */
export function TrayTable({ rows, sort, defaultExpanded = false, highlightMatches = false, linkState, updating }: TrayTableProps) {
  const { isExpanded, onToggle } = useRowToggles(defaultExpanded);

  const header = (label: string, key?: TraySortKey) =>
    sort && key ? (
      <SortableColumnHeader
        label={label}
        active={sort.by === key}
        dir={sort.dir}
        onClick={() => sort.onSort(key)}
      />
    ) : (
      label
    );

  return (
    <div className={list.tableWrap}>
      <table className={`table ${list.table} ${updating ? list.updating : ""}`}>
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>{header("Tray", "tray")}</th>
            <th>Chemistry</th>
            <th>{header("Instrument", "instrument")}</th>
            <th>Cells</th>
            <th>{header("Uses left", "uses_left")}</th>
            <th>{header("First use", "first_use")}</th>
            <th>{header("Last run", "last_run")}</th>
            <th>{header("Expires", "expiry")}</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <TrayRow
                key={key}
                rowKey={key}
                row={row}
                expanded={isExpanded(key)}
                onToggle={onToggle}
                highlightMatches={highlightMatches}
                linkState={linkState}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface TrayRowProps {
  rowKey: string;
  row: CellTrayRowOut;
  expanded: boolean;
  /** One stable handler for every row, so this memoized row only re-renders when its own data
   * or open state changes (not on every search keystroke). */
  onToggle: (key: string) => void;
  highlightMatches: boolean;
  linkState: SampleDetailLocationState;
}

const TrayRow = memo(function TrayRow({ rowKey, row, expanded, onToggle, highlightMatches, linkState }: TrayRowProps) {
  const matched = highlightMatches ? new Set(row.matched_cell_ids) : undefined;
  const capacity = row.cells.reduce((n, c) => n + c.max_uses, 0);
  const label = row.tray_id !== null ? `tray ${row.tray_id}` : row.cells[0]?.code;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <>
      <tr className={list.row} onClick={() => onToggle(rowKey)}>
        <RowToggle expanded={expanded} label={`${label}'s cells`} />
        <td className={list.nowrap}>
          {row.tray_id !== null ? (
            <Link
              to={`/cells?tray=${row.tray_id}`}
              state={linkState}
              className={`link ${list.mono}`}
              onClick={stop}
              title="Open this tray's own page"
            >
              Tray {row.tray_id}
            </Link>
          ) : (
            <span className={list.faint} title="Registered with Register in-progress cell, so it has no tray on record">
              No tray
            </span>
          )}
        </td>
        <td>{row.cell_type === "sprq" ? <CellTypeBadge cellType="sprq" /> : "SPRQ-Nx"}</td>
        <td className={list.mono}>{row.instrument_serial ?? "—"}</td>
        <td>
          <TrayCellStrip cells={row.cells} matchedIds={matched} linkState={linkState} />
        </td>
        <td className={list.nowrap} title={`${row.uses_left} of the tray's ${capacity} uses still available`}>
          <b>{row.uses_left}</b>
          <span className={list.faint}> / {capacity}</span>
        </td>
        <td className={list.nowrap}>{row.first_use_at ? formatDateTime(row.first_use_at) : "—"}</td>
        <td className={list.nowrap}>{row.last_run_date ? formatDateUTC(parseDateOnly(row.last_run_date)) : "—"}</td>
        <td className={list.nowrap}>
          <TrayExpiry row={row} />
        </td>
        <td>
          <TrayFlags row={row} />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMN_COUNT} className={list.detailCell}>
            <TrayCells cells={row.cells} matched={matched} linkState={linkState} />
            {row.tray_id !== null && <TrayActions trayId={row.tray_id} cells={row.cells} />}
          </td>
        </tr>
      )}
    </>
  );
});

/** When the tray's soonest 108h window closes - the deadline to start its next reuse. */
function TrayExpiry({ row }: { row: CellTrayRowOut }) {
  if (row.expires_at !== null && row.expires_in_hours !== null) {
    const urgent = row.expires_in_hours <= EXPIRY_WARN_HOURS;
    return (
      <>
        {formatDateTime(row.expires_at)}
        <span className={urgent ? styles.subUrgent : styles.sub}>{formatHoursLeft(row.expires_in_hours)}</span>
      </>
    );
  }
  if (row.cells.some((c) => c.status === "window_expired")) {
    return <span className={styles.expired}>Window closed</span>;
  }
  if (row.cell_type !== "sprq" && row.cells.some((c) => c.status === "open")) {
    return (
      <span className={list.faint} title="The 108-hour window starts when the tray's first cell is used">
        Not started
      </span>
    );
  }
  return <span title={row.cell_type === "sprq" ? "Single-use cells have no reuse window" : undefined}>—</span>;
}

/** Anything about the tray that needs a second look: an open PacBio credit case, a planned
 * disposal (reuse skipped), or a discard that threw away unused uses. */
function TrayFlags({ row }: { row: CellTrayRowOut }) {
  const unreported = row.cells.some((c) => c.needs_qc_report);
  const awaiting = row.cells.some((c) => c.awaiting_credit);
  const discarded = row.cells.find(discardedWithUsesLeft);
  if (!unreported && !awaiting && !row.reuse_disabled && !discarded) return null;
  return (
    <span className={list.flags}>
      {unreported && (
        <Badge tone={CELL_QC_FLAG_TONE.unreported} title="A cell failed or was stopped and hasn't been reported to PacBio yet">
          {CELL_QC_FLAG_LABEL.unreported}
        </Badge>
      )}
      {awaiting && (
        <Badge tone={CELL_QC_FLAG_TONE.awaiting_credit} title="Reported to PacBio - the credit hasn't arrived yet">
          {CELL_QC_FLAG_LABEL.awaiting_credit}
        </Badge>
      )}
      {row.reuse_disabled && (
        <Badge tone="warning" title="Planned for disposal - Autoschedule won't reuse this tray">
          Reuse skipped
        </Badge>
      )}
      {discarded && (
        <Badge title={discarded.discarded_reason ?? "Discarded before all its uses were spent"}>Discarded</Badge>
      )}
    </span>
  );
}

function cellWindow(cell: CellOut) {
  const left = windowHoursRemaining(cell);
  if (left !== null) {
    return (
      <span
        className={left <= EXPIRY_WARN_HOURS ? styles.urgent : undefined}
        title={`${(cell.window_hours_elapsed ?? 0).toFixed(1)} h of 108 h used`}
      >
        {formatHoursLeft(left)}
      </span>
    );
  }
  if (cell.status === "window_expired") return <span className={styles.expired}>Closed</span>;
  if (cell.status === "open" && cell.cell_type !== "sprq") {
    return <span className={list.faint}>Not started</span>;
  }
  return "—";
}

/** The expanded tray: each cell with its status, uses, window, the samples and runs it carried,
 * and its burned barcodes. */
function TrayCells({
  cells,
  matched,
  linkState,
}: {
  cells: CellOut[];
  matched: ReadonlySet<number> | undefined;
  linkState: SampleDetailLocationState;
}) {
  return (
    <table className={`table ${list.innerTable}`}>
      <thead>
        <tr>
          <th>Cell</th>
          <th>Status</th>
          <th>Uses</th>
          <th>Window</th>
          <th>Samples &amp; runs</th>
          <th>Burned barcodes</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((cell) => {
          const uses = cell.uses.filter((u) => u.status !== "cancelled");
          const reason = cell.stopped_reason ?? cell.discarded_reason ?? undefined;
          return (
            <tr key={cell.id} className={matched?.has(cell.id) ? list.matchedRow : undefined}>
              <td className={list.nowrap}>
                <Link to={`/cells/${cell.id}`} state={linkState} className={`link ${list.mono}`}>
                  {cell.code}
                </Link>
              </td>
              <td>
                <span className={list.flags}>
                  <Badge tone={CELL_STATUS_TONE[cell.status]} title={reason}>
                    {CELL_STATUS_LABEL[cell.status]}
                  </Badge>
                  {discardedWithUsesLeft(cell) && <Badge title={reason}>Discarded</Badge>}
                  {cell.needs_qc_report && (
                    <Badge tone={CELL_QC_FLAG_TONE.unreported}>{CELL_QC_FLAG_LABEL.unreported}</Badge>
                  )}
                  {!cell.needs_qc_report && cell.awaiting_credit && (
                    <Badge tone={CELL_QC_FLAG_TONE.awaiting_credit}>{CELL_QC_FLAG_LABEL.awaiting_credit}</Badge>
                  )}
                </span>
              </td>
              <td className={list.nowrap}>
                {cell.uses_consumed} / {cell.max_uses}
              </td>
              <td className={list.nowrap}>{cellWindow(cell)}</td>
              <td>
                {uses.length === 0 ? (
                  <span className={list.faint}>Not used yet</span>
                ) : (
                  uses.map((use, i) => (
                    <div key={use.id} className={styles.useLine}>
                      <UseBox use={i + 1} cellType={cell.cell_type} />
                      <Badge tone={USE_STATUS_TONE[use.status] ?? "default"}>{cellUseStatusLabel(use.status)}</Badge>
                      {use.sample_id !== null && use.sample_pool_id !== null ? (
                        <Link to={`/samples/${use.sample_id}`} state={linkState} className="link">
                          {use.sample_pool_id}
                        </Link>
                      ) : (
                        <span className={list.faint}>no sample</span>
                      )}
                      {use.run_batch_id > 0 && (
                        <>
                          <span className={list.faint}>·</span>
                          <Link
                            to={`/history/runs/${use.run_batch_id}`}
                            state={linkState}
                            className={`link ${styles.runLink}`}
                          >
                            {runLabel({ run_id: use.run_batch_id, run_name: use.run_name })}
                          </Link>
                        </>
                      )}
                    </div>
                  ))
                )}
              </td>
              <td>{cell.burned_barcodes.length > 0 ? <BarcodeChips barcodes={cell.burned_barcodes} /> : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

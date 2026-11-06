import { memo } from "react";
import { Link } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { RowToggle, useRowToggles } from "@/components/shared/ListPage";
import list from "@/components/shared/ListPage.module.css";
import { SortableColumnHeader } from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/Badge";
import type { SampleCellUseOut, SampleDetailOut } from "@/types/sample";
import { formatDateTime, formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import type { SortDir } from "@/utils/listView";
import { runLabel } from "@/utils/runLabel";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";
import { SAMPLE_STATUS_LABEL, SAMPLE_STATUS_TONE } from "@/utils/sampleStatus";
import { cellUseStatusLabel, USE_STATUS_TONE } from "@/utils/useStatusTone";

import type { SampleListSortKey } from "./samplesView";
import { SampleRunChips } from "./SampleRunChips";

const COLUMN_COUNT = 10;

export interface SampleHistoryTableProps {
  rows: SampleDetailOut[];
  sort: { by: SampleListSortKey; dir: SortDir; onSort: (key: SampleListSortKey) => void };
  /** Rows start expanded (a search with one hit); a click still toggles. */
  defaultExpanded: boolean;
  /** Router state for every sample / run / cell link, so their Back returns here. */
  linkState: SampleDetailLocationState;
  /** Dim the rows while the next page / filter loads over them. */
  updating: boolean;
}

/** The Samples table: one row per sample - Pool ID, status, a chip per run it has been placed
 * on, barcodes, Plate ID, OPLCs, priority and last update - expanding to each cell use. */
export function SampleHistoryTable({ rows, sort, defaultExpanded, linkState, updating }: SampleHistoryTableProps) {
  const { isExpanded, onToggle } = useRowToggles(defaultExpanded);

  const header = (label: string, key: SampleListSortKey) => (
    <SortableColumnHeader label={label} active={sort.by === key} dir={sort.dir} onClick={() => sort.onSort(key)} />
  );

  return (
    <div className={list.tableWrap}>
      <table className={`table ${list.table} ${updating ? list.updating : ""}`}>
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>{header("Pool ID", "pool_id")}</th>
            <th>{header("Status", "status")}</th>
            <th>Runs</th>
            <th>{header("Barcodes", "barcode")}</th>
            <th>{header("Plate ID", "plate_id")}</th>
            <th>{header("Target OPLC", "target_oplc")}</th>
            <th>{header("Actual OPLC", "actual_oplc")}</th>
            <th>{header("Priority", "priority")}</th>
            <th>{header("Updated", "updated_at")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((sample) => (
            <SampleRow
              key={sample.id}
              sample={sample}
              expanded={isExpanded(sample.id)}
              onToggle={onToggle}
              linkState={linkState}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SampleRowProps {
  sample: SampleDetailOut;
  expanded: boolean;
  /** One stable handler for every row, so this memoized row only re-renders when its own data
   * or open state changes. */
  onToggle: (sampleId: number) => void;
  linkState: SampleDetailLocationState;
}

const SampleRow = memo(function SampleRow({ sample, expanded, onToggle, linkState }: SampleRowProps) {
  return (
    <>
      <tr className={list.row} onClick={() => onToggle(sample.id)}>
        <RowToggle expanded={expanded} label={`${sample.pool_id}'s cell uses`} />
        <td>
          <Link
            to={`/samples/${sample.id}`}
            state={linkState}
            className="link"
            onClick={(e) => e.stopPropagation()}
            title="Open this sample's page"
          >
            {sample.pool_id}
          </Link>{" "}
          <DuplicateBadge index={sample.duplicate_index} total={sample.duplicate_total} />
        </td>
        <td>
          <Badge tone={SAMPLE_STATUS_TONE[sample.status]}>{SAMPLE_STATUS_LABEL[sample.status]}</Badge>
        </td>
        <td>
          <SampleRunChips uses={sample.cell_uses} linkState={linkState} />
        </td>
        <td>
          <BarcodeChips barcodes={sample.barcodes} />
        </td>
        <td>{sample.plate_id ?? "—"}</td>
        <td>{sample.target_oplc ?? "—"}</td>
        <td>{sample.actual_oplc ?? "—"}</td>
        <td>{sample.priority ?? "—"}</td>
        <td className={list.nowrap}>{formatDateTime(sample.updated_at)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLUMN_COUNT} className={list.detailCell}>
            {sample.cell_uses.length === 0 ? (
              <div className="status sm">This sample hasn&apos;t been placed on a cell yet.</div>
            ) : (
              <SampleUses uses={sample.cell_uses} linkState={linkState} />
            )}
          </td>
        </tr>
      )}
    </>
  );
});

/** The expanded sample: every cell use - run, when and where it loaded, plate, cell and well,
 * outcome, times and notes. */
function SampleUses({ uses, linkState }: { uses: SampleCellUseOut[]; linkState: SampleDetailLocationState }) {
  return (
    <table className={`table ${list.innerTable}`}>
      <thead>
        <tr>
          <th>Run</th>
          <th>Load date</th>
          <th>Instrument</th>
          <th>Plate</th>
          <th>Cell</th>
          <th>Well</th>
          <th>Status</th>
          <th>Started</th>
          <th>Completed</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {uses.map((u) => (
          <tr key={u.id}>
            <td className={list.nowrap}>
              <Link to={`/history/runs/${u.run_batch_id}`} state={linkState} className={`link ${list.mono}`}>
                {runLabel({ run_id: u.run_batch_id, run_name: u.run_name })}
              </Link>
            </td>
            <td className={list.nowrap}>{u.load_date ? formatDateUTC(parseDateOnly(u.load_date)) : "—"}</td>
            <td className={list.mono}>{u.instrument_serial ?? "—"}</td>
            <td className={list.nowrap}>{u.plate_number != null ? `Plate ${u.plate_number}` : "—"}</td>
            <td className={list.nowrap}>
              <Link to={`/cells/${u.cell_id}`} state={linkState} className={`link ${list.mono}`}>
                {u.cell_code}
              </Link>
            </td>
            <td className={list.mono}>{u.well}</td>
            <td>
              <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{cellUseStatusLabel(u.status)}</Badge>
            </td>
            <td className={list.nowrap}>{u.started_at ? formatDateTime(u.started_at) : "—"}</td>
            <td className={list.nowrap}>{u.completed_at ? formatDateTime(u.completed_at) : "—"}</td>
            <td>{u.outcome_notes ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

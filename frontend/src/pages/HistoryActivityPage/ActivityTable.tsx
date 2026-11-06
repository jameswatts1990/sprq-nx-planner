import { memo } from "react";
import { Link } from "react-router-dom";

import list from "@/components/shared/ListPage.module.css";
import type { AuditLink, AuditLogOut } from "@/types/audit";
import { actionLabel, describeAuditDetails } from "@/utils/auditLabels";
import { formatDateTime } from "@/utils/calendarDates";
import type { SampleDetailLocationState } from "@/utils/sampleBackNav";

import styles from "./ActivityTable.module.css";

const LINK_ROUTE: Record<AuditLink["kind"], (id: number) => string> = {
  run: (id) => `/history/runs/${id}`,
  sample: (id) => `/samples/${id}`,
  cell: (id) => `/cells/${id}`,
  tray: (id) => `/cells?tray=${id}`,
  instrument: () => "/instruments",
};

const GONE_NOUN: Record<string, string> = {
  run_batch: "Run",
  sample: "Sample",
  cell: "Cell",
  cell_use: "Placement",
  cell_tray: "Tray",
  instrument: "Instrument",
  sample_topup: "Resupply",
};

/** What a row is about when it has no live link: a page that holds it, or just its name (a
 * sample an undone import removed, a deleted run). */
function aboutFallback(row: AuditLogOut): { label: string; to?: string } | null {
  const d = row.details_json;
  switch (row.entity_type) {
    case "app_setting":
      return { label: "Settings", to: "/settings" };
    case "import_batch":
      return { label: typeof d.source_filename === "string" ? d.source_filename : "Pasted import", to: "/import" };
    case "pacbio_case":
      return { label: `Credit case #${row.entity_id}`, to: "/qc" };
    case "schedule_note":
      return typeof d.note_date === "string"
        ? { label: "Day note", to: `/schedule?from=${d.note_date}` }
        : { label: "Day note", to: "/schedule" };
    case "cycle":
      return { label: "Schedule", to: "/schedule" };
  }
  if (row.entity_id === null) return null;
  const name =
    row.entity_type === "sample" && typeof d.pool_id === "string"
      ? d.pool_id
      : `${GONE_NOUN[row.entity_type] ?? "Item"} #${row.entity_id}`;
  return { label: `${name} (no longer exists)` };
}


export interface ActivityTableProps {
  rows: AuditLogOut[];
  /** Router state for every link, so its Back returns here. */
  linkState: SampleDetailLocationState;
  /** Dim the rows while the next page / filter loads over them. */
  updating: boolean;
}

/** The Activity table: one row per change - when, who, what, what it was about (linked) and the
 * detail it recorded (an edit's before → after). Newest first. */
export function ActivityTable({ rows, linkState, updating }: ActivityTableProps) {
  return (
    <div className={list.tableWrap}>
      <table className={`table ${list.table} ${updating ? list.updating : ""}`}>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>About</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ActivityRow key={row.id} row={row} linkState={linkState} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ActivityRow = memo(function ActivityRow({
  row,
  linkState,
}: {
  row: AuditLogOut;
  linkState: SampleDetailLocationState;
}) {
  const details = describeAuditDetails(row);
  const fallback = row.links.length ? null : aboutFallback(row);
  return (
    <tr>
      <td className={list.nowrap}>{formatDateTime(row.at)}</td>
      <td>{row.actor === "unknown" ? <span className={list.faint}>Unknown</span> : row.actor}</td>
      <td className={styles.action}>{actionLabel(row)}</td>
      <td>
        <div className={styles.about}>
          {row.links.map((link) => (
            <Link
              key={`${link.kind}-${link.id}`}
              to={LINK_ROUTE[link.kind](link.id)}
              state={linkState}
              className={`link ${link.kind === "cell" ? list.mono : ""}`}
            >
              {link.label}
            </Link>
          ))}
          {fallback &&
            (fallback.to ? (
              <Link to={fallback.to} className="link">
                {fallback.label}
              </Link>
            ) : (
              <span className={list.faint}>{fallback.label}</span>
            ))}
        </div>
      </td>
      <td className={styles.details}>
        {details.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </td>
    </tr>
  );
});

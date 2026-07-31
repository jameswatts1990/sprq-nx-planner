import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import { CREDIT_BUCKET_LABEL, CREDIT_BUCKET_TONE, type CreditBucket, creditBucket } from "@/utils/creditCase";

import { QcCaseRow } from "./QcCaseRow";
import styles from "./QcPage.module.css";

/** When a case "happened", for ordering open buckets oldest-first (the oldest open case is the
 * one most in need of chasing): the stop time, else the last run's date, else when it was created. */
function caseAgeMs(cell: CellOut): number {
  const t = Date.parse(cell.stopped_at ?? cell.last_use_run_date ?? cell.created_at);
  return Number.isNaN(t) ? 0 : t;
}
function receivedMs(cell: CellOut): number {
  const t = cell.credit_received_at ? Date.parse(cell.credit_received_at) : 0;
  return Number.isNaN(t) ? 0 : t;
}

interface QcGroups {
  needs_report: CellOut[];
  awaiting: CellOut[];
  confirmed: CellOut[];
  received: CellOut[];
}

/** The open stage groups, shown in workflow order above the collapsed Received tail. */
const OPEN_BUCKETS: Exclude<CreditBucket, "received">[] = ["needs_report", "awaiting", "confirmed"];

/**
 * QC — the home for every cell in the PacBio credit-recovery workflow. High-level counts up top,
 * then a worklist of cases grouped by stage (Needs report → Awaiting credit → Confirmed), each row
 * carrying the next action inline and expanding to the full credit tracker. Recently-settled cases
 * sit in a collapsed "Received" group so they stay monitorable without cluttering the active work.
 */
export function QcPage() {
  const [receivedOpen, setReceivedOpen] = useState(false);

  const query = useQuery({
    queryKey: ["cells", { qc_status: "in_workflow" }],
    queryFn: () => cellsApi.listAll({ qc_status: "in_workflow" }),
  });
  const cells = query.data ?? [];

  const groups = useMemo<QcGroups>(() => {
    const g: QcGroups = { needs_report: [], awaiting: [], confirmed: [], received: [] };
    for (const c of cells) g[creditBucket(c)].push(c);
    g.needs_report.sort((a, b) => caseAgeMs(a) - caseAgeMs(b));
    g.awaiting.sort((a, b) => caseAgeMs(a) - caseAgeMs(b));
    g.confirmed.sort((a, b) => caseAgeMs(a) - caseAgeMs(b));
    g.received.sort((a, b) => receivedMs(b) - receivedMs(a));
    return g;
  }, [cells]);

  const samplesAffected = useMemo(() => {
    // Distinct samples on a failed use across the OPEN cases - the "samples currently in QC" count.
    const ids = new Set<number>();
    for (const c of cells) {
      if (creditBucket(c) === "received") continue;
      for (const u of c.uses) if (u.status === "failed" && u.sample_id !== null) ids.add(u.sample_id);
    }
    return ids.size;
  }, [cells]);

  const open = groups.needs_report.length + groups.awaiting.length + groups.confirmed.length;

  return (
    <div className={styles.page}>
      <Card>
        <CardBody>
          <StatTiles>
            <StatTile label="Open cases" value={open} hint="not yet received" />
            <StatTile label="Needs report" value={groups.needs_report.length} />
            <StatTile label="Awaiting credit" value={groups.awaiting.length} hint="reported to PacBio" />
            <StatTile label="Confirmed" value={groups.confirmed.length} hint="awaiting receipt" />
            <StatTile label="Credit received" value={groups.received.length} />
            <StatTile label="Samples affected" value={samplesAffected} hint="in open cases" />
          </StatTiles>
        </CardBody>
      </Card>

      {query.isLoading && <div className={styles.status}>Loading QC cases…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load QC cases."}
        </Note>
      )}
      {!query.isLoading && !query.isError && cells.length === 0 && (
        <Note tone="good" icon="✓">
          No cells are in the QC workflow right now — nothing failed or stopped is awaiting a PacBio credit.
        </Note>
      )}

      {OPEN_BUCKETS.map((b) =>
        groups[b].length > 0 ? (
          <section key={b} className={styles.group}>
            <SectionHeading
              title={CREDIT_BUCKET_LABEL[b]}
              legend={<Badge tone={CREDIT_BUCKET_TONE[b]}>{groups[b].length}</Badge>}
            />
            <div className={styles.rows}>
              {groups[b].map((c) => (
                <QcCaseRow key={c.id} cell={c} />
              ))}
            </div>
          </section>
        ) : null,
      )}

      {groups.received.length > 0 && (
        <section className={styles.group}>
          <button
            type="button"
            className={styles.receivedToggle}
            aria-expanded={receivedOpen}
            onClick={() => setReceivedOpen((v) => !v)}
          >
            <span className={styles.receivedCx} data-open={receivedOpen}>
              ▸
            </span>
            {CREDIT_BUCKET_LABEL.received}
            <Badge tone={CREDIT_BUCKET_TONE.received}>{groups.received.length}</Badge>
          </button>
          {receivedOpen && (
            <div className={styles.rows}>
              {groups.received.map((c) => (
                <QcCaseRow key={c.id} cell={c} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

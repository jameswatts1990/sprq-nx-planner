import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import {
  CREDIT_BUCKET_LABEL,
  CREDIT_BUCKET_TONE,
  type CreditBucket,
  creditBucket,
  NO_CELL_BADGE,
} from "@/utils/creditCase";

import { PacbioCaseModal } from "./PacbioCaseModal";
import { PacbioCaseRow } from "./PacbioCaseRow";
import { CellCaseRow } from "./QcCaseRow";
import { type QcCase, qcCaseAgeMs, qcCaseCredit, qcCaseKey, qcCaseReceivedMs } from "./qcCases";
import styles from "./QcPage.module.css";

type QcGroups = Record<CreditBucket, QcCase[]>;

/** The open stage groups, shown in workflow order above the collapsed Received tail. */
const OPEN_BUCKETS: Exclude<CreditBucket, "received">[] = ["needs_report", "awaiting", "confirmed"];

function QcCaseItem({ item }: { item: QcCase }) {
  return item.kind === "cell" ? <CellCaseRow cell={item.cell} /> : <PacbioCaseRow pacbioCase={item.pacbioCase} />;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * QC — the one home for every PacBio credit case: cells that Failed or were Stopped (they join
 * automatically) plus cases logged by hand without a cell (Add case without a cell). High-level
 * counts up top, then a worklist grouped by stage (Needs report → Awaiting credit → Confirmed),
 * each row carrying the next action inline and expanding to the full credit tracker. Both kinds
 * share the groups and actions; a no-cell case is flagged on its row. Recently-settled cases sit
 * in a collapsed "Received" group so they stay monitorable without cluttering the active work.
 */
export function QcPage() {
  const [receivedOpen, setReceivedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<PacbioCaseOut | null>(null);

  const cellsQuery = useQuery({
    queryKey: ["cells", { qc_status: "in_workflow" }],
    queryFn: () => cellsApi.listAll({ qc_status: "in_workflow" }),
  });
  const casesQuery = useQuery({ queryKey: ["pacbio-cases"], queryFn: pacbioCasesApi.list });

  const items = useMemo<QcCase[]>(
    () => [
      ...(cellsQuery.data ?? []).map((cell): QcCase => ({ kind: "cell", cell })),
      ...(casesQuery.data ?? []).map((pacbioCase): QcCase => ({ kind: "no_cell", pacbioCase })),
    ],
    [cellsQuery.data, casesQuery.data],
  );

  const groups = useMemo<QcGroups>(() => {
    const g: QcGroups = { needs_report: [], awaiting: [], confirmed: [], received: [] };
    for (const item of items) g[creditBucket(qcCaseCredit(item))].push(item);
    for (const b of OPEN_BUCKETS) g[b].sort((a, b2) => qcCaseAgeMs(a) - qcCaseAgeMs(b2));
    g.received.sort((a, b) => qcCaseReceivedMs(b) - qcCaseReceivedMs(a));
    return g;
  }, [items]);

  const samplesAffected = useMemo(() => {
    // Distinct samples on a failed use across the OPEN cell cases - the "samples currently in QC"
    // count. A no-cell case's sample is free text, not a RunNx sample, so it isn't counted.
    const ids = new Set<number>();
    for (const item of items) {
      if (item.kind !== "cell" || creditBucket(item.cell) === "received") continue;
      for (const u of item.cell.uses) if (u.status === "failed" && u.sample_id !== null) ids.add(u.sample_id);
    }
    return ids.size;
  }, [items]);

  const acquisitionsCredited = items.reduce((sum, item) => {
    const credit = qcCaseCredit(item);
    return sum + (credit.pacbio_credit_confirmed_at ? (credit.credit_acquisitions ?? 0) : 0);
  }, 0);

  const open = groups.needs_report.length + groups.awaiting.length + groups.confirmed.length;
  const loading = cellsQuery.isLoading || casesQuery.isLoading;
  const loaded = !loading && !cellsQuery.isError && !casesQuery.isError;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>PacBio credit cases</h1>
        <div className={styles.spacer} />
        <Button
          onClick={() => {
            setJustAdded(null);
            setAddOpen(true);
          }}
          title="Log a PacBio credit case that isn't linked to any cell in RunNx"
        >
          + Add case without a cell
        </Button>
      </div>

      <Card>
        <CardBody>
          <StatTiles>
            <StatTile label="Open cases" value={open} hint="not yet received" />
            <StatTile label="Needs report" value={groups.needs_report.length} />
            <StatTile label="Awaiting credit" value={groups.awaiting.length} hint="reported to PacBio" />
            <StatTile label="Confirmed" value={groups.confirmed.length} hint="awaiting receipt" />
            <StatTile label="Credit received" value={groups.received.length} />
            <StatTile label="Acquisitions credited" value={acquisitionsCredited} hint="confirmed by PacBio" />
            <StatTile label="Samples affected" value={samplesAffected} hint="in open cases" />
          </StatTiles>
        </CardBody>
      </Card>

      {justAdded && (
        <Note tone="good" icon="✓">
          Added “{justAdded.summary}” as a case without a cell — it&apos;s in the list below, flagged{" "}
          <b>{NO_CELL_BADGE.label}</b>.
        </Note>
      )}

      {loading && <div className={styles.status}>Loading QC cases…</div>}
      {cellsQuery.isError && (
        <Note tone="bad" icon="!">
          {errorText(cellsQuery.error, "Failed to load the cells' QC cases.")}
        </Note>
      )}
      {casesQuery.isError && (
        <Note tone="bad" icon="!">
          {errorText(casesQuery.error, "Failed to load the cases logged without a cell.")}
        </Note>
      )}
      {loaded && items.length === 0 && (
        <Note tone="good" icon="✓">
          No PacBio credit cases right now — no cell has failed or been stopped, and no case without a cell has been
          logged.
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
              {groups[b].map((item) => (
                <QcCaseItem key={qcCaseKey(item)} item={item} />
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
              {groups.received.map((item) => (
                <QcCaseItem key={qcCaseKey(item)} item={item} />
              ))}
            </div>
          )}
        </section>
      )}

      {addOpen && (
        <PacbioCaseModal
          onClose={() => setAddOpen(false)}
          onSaved={(saved) => {
            setAddOpen(false);
            setJustAdded(saved);
          }}
        />
      )}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import {
  acquisitionsToTrays,
  CREDIT_BUCKET_LABEL,
  CREDIT_BUCKET_TONE,
  CREDIT_OVERDUE_DAYS,
  type CreditBucket,
  creditBucket,
  formatQuantity,
  NO_CELL_BADGE,
} from "@/utils/creditCase";
import { csvSafe, downloadCsv, toCsv } from "@/utils/toCsv";

import { PacbioCaseModal } from "./PacbioCaseModal";
import { PacbioCaseRow } from "./PacbioCaseRow";
import { CellCaseRow, type RowExpansion } from "./QcCaseRow";
import {
  QC_CSV_HEADERS,
  type QcCase,
  qcCaseAge,
  qcCaseCredit,
  qcCaseCsvRow,
  qcCaseExpected,
  qcCaseFailureMs,
  qcCaseKey,
  qcCaseMatches,
  qcCaseReceivedMs,
} from "./qcCases";
import styles from "./QcPage.module.css";

type QcGroups = Record<CreditBucket, QcCase[]>;

/** The open stage groups, shown in workflow order above the collapsed Received tail. */
const OPEN_BUCKETS: Exclude<CreditBucket, "received">[] = ["needs_report", "awaiting", "confirmed"];

/** Remember per browser whether the overview strip is shown (a per-viewer convenience). */
const OVERVIEW_KEY = "runnx.qc.overviewOpen";
function readOverviewOpen(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeOverviewOpen(open: boolean): void {
  try {
    localStorage.setItem(OVERVIEW_KEY, open ? "1" : "0");
  } catch {
    /* ignore - remembering is a convenience, not a requirement */
  }
}

function QcCaseItem({ item, nowMs, ...expansion }: { item: QcCase; nowMs: number } & RowExpansion) {
  const age = qcCaseAge(item, nowMs);
  return item.kind === "cell" ? (
    <CellCaseRow cell={item.cell} expected={qcCaseExpected(item)} age={age} {...expansion} />
  ) : (
    <PacbioCaseRow pacbioCase={item.pacbioCase} age={age} {...expansion} />
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function groupCases(items: QcCase[]): QcGroups {
  const g: QcGroups = { needs_report: [], awaiting: [], confirmed: [], received: [] };
  for (const item of items) g[creditBucket(qcCaseCredit(item))].push(item);
  const age = (i: QcCase) => qcCaseFailureMs(i) ?? 0;
  for (const b of OPEN_BUCKETS) g[b].sort((a, b2) => age(a) - age(b2));
  g.received.sort((a, b) => qcCaseReceivedMs(b) - qcCaseReceivedMs(a));
  return g;
}

/** The operations-manager glance: one slim line of totals across every case (never the search
 * results), so it costs almost no height. Credited acquisitions are also shown as trays - PacBio's
 * FOC tracker counts trays (1 cell = 3 acquisitions = 0.25 tray). */
function OverviewStrip({ items, groups, nowMs }: { items: QcCase[]; groups: QcGroups; nowMs: number }) {
  let overdue = 0;
  let pending = 0;
  let credited = 0;
  for (const item of items) {
    const credit = qcCaseCredit(item);
    if (credit.pacbio_credit_confirmed_at) credited += credit.credit_acquisitions ?? 0;
    else if (!credit.credit_received_at) pending += qcCaseExpected(item) ?? 0;
    if (qcCaseAge(item, nowMs)?.overdue) overdue += 1;
  }
  const open = groups.needs_report.length + groups.awaiting.length + groups.confirmed.length;
  const stat = (label: string, value: string | number, title?: string, alert = false) => (
    <span className={styles.ovItem} title={title} data-alert={alert}>
      <span className={styles.ovLabel}>{label}</span>
      <span className={styles.ovValue}>{value}</span>
    </span>
  );
  return (
    <div className={styles.overview} aria-label="Credit case totals">
      {stat("Open", open, "Cases not yet received")}
      {stat("Overdue", overdue, `Open cases stuck at one stage for more than ${CREDIT_OVERDUE_DAYS} days`, overdue > 0)}
      <span className={styles.ovSep} aria-hidden="true" />
      {stat("Needs report", groups.needs_report.length)}
      {stat("Awaiting PacBio", groups.awaiting.length)}
      {stat("Confirmed", groups.confirmed.length, "Credit confirmed by PacBio, not yet received")}
      {stat("Received", groups.received.length)}
      <span className={styles.ovSep} aria-hidden="true" />
      {stat("Acq pending", pending, "Acquisitions expected back on open cases PacBio haven't confirmed yet")}
      {stat(
        "Acq credited",
        `${credited} · ${formatQuantity(acquisitionsToTrays(credited))} tray`,
        "Acquisitions PacBio confirmed (confirmed + received cases); 1 cell = 3 acquisitions = 0.25 tray",
      )}
    </div>
  );
}

/**
 * QC — the one home for every PacBio credit case: cells that Failed or were Stopped (they join
 * automatically) plus cases logged by hand without a cell (Add case without a cell). A slim,
 * collapsible totals strip up top, a search + CSV export, then a worklist grouped by stage
 * (Needs report → Awaiting credit → Confirmed), each row showing case #, acquisitions, owner and
 * age, carrying the next action inline and expanding to the full credit tracker. Recently-settled
 * cases sit in a collapsed "Received" group (opened automatically when a search matches there).
 */
export function QcPage() {
  const [receivedOpen, setReceivedOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(readOverviewOpen);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<PacbioCaseOut | null>(null);
  // Which rows are expanded, by case key - kept here so a row stays open when an action moves its
  // case into another stage group (that remounts the row).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const expansion = (item: QcCase): RowExpansion => {
    const key = qcCaseKey(item);
    return {
      open: expanded.has(key),
      onToggle: () =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
    };
  };

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
  const shown = useMemo(() => items.filter((item) => qcCaseMatches(item, query)), [items, query]);
  const allGroups = useMemo(() => groupCases(items), [items]);
  const groups = useMemo(() => groupCases(shown), [shown]);
  // Ages (days open / overdue) as of the latest fetch - stable across re-renders, and day-accurate.
  const nowMs = Math.max(cellsQuery.dataUpdatedAt, casesQuery.dataUpdatedAt);

  const searching = query.trim() !== "";
  const showReceived = receivedOpen || (searching && groups.received.length > 0);
  const loading = cellsQuery.isLoading || casesQuery.isLoading;
  const loaded = !loading && !cellsQuery.isError && !casesQuery.isError;

  function toggleOverview() {
    setOverviewOpen((v) => {
      writeOverviewOpen(!v);
      return !v;
    });
  }

  function exportCsv() {
    const rows = shown.map((item) => qcCaseCsvRow(item, nowMs).map(csvSafe));
    downloadCsv(`pacbio-credit-cases-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(QC_CSV_HEADERS, rows));
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.titleToggle}
          aria-expanded={overviewOpen}
          onClick={toggleOverview}
          title={overviewOpen ? "Hide the totals" : "Show the totals"}
        >
          <h1 className={styles.title}>PacBio credit cases</h1>
          <span className={styles.receivedCx} data-open={overviewOpen}>
            ▸
          </span>
        </button>
        <div className={styles.spacer} />
        <input
          type="search"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search case #, cell, Pool ID, run, owner…"
          aria-label="Search credit cases"
        />
        <Button
          variant="ghost"
          onClick={exportCsv}
          disabled={shown.length === 0}
          title="Download these cases as a spreadsheet (credited acquisitions also as cells and trays)"
        >
          Export CSV{searching ? ` (${shown.length})` : ""}
        </Button>
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

      {overviewOpen && loaded && <OverviewStrip items={items} groups={allGroups} nowMs={nowMs} />}

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
      {loaded && items.length > 0 && searching && shown.length === 0 && (
        <Note tone="info" icon="i">
          No cases match “{query.trim()}”. Search looks at the case number, internal report ID, owner, cell code or
          summary, run, sample and instrument.
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
                <QcCaseItem key={qcCaseKey(item)} item={item} nowMs={nowMs} {...expansion(item)} />
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
            aria-expanded={showReceived}
            onClick={() => setReceivedOpen((v) => !v)}
          >
            <span className={styles.receivedCx} data-open={showReceived}>
              ▸
            </span>
            {CREDIT_BUCKET_LABEL.received}
            <Badge tone={CREDIT_BUCKET_TONE.received}>{groups.received.length}</Badge>
          </button>
          {showReceived && (
            <div className={styles.rows}>
              {groups.received.map((item) => (
                <QcCaseItem key={qcCaseKey(item)} item={item} nowMs={nowMs} {...expansion(item)} />
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

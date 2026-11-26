import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { errorMessage } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { qcApi } from "@/api/qc";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { useOverdueDays } from "@/hooks/useOverdueDays";
import type { CellType } from "@/types/common";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import {
  acquisitionsToTrays,
  CREDIT_BUCKET_LABEL,
  CREDIT_BUCKET_TONE,
  type CreditBucket,
  creditBucket,
  formatQuantity,
  NO_CELL_BADGE,
} from "@/utils/creditCase";
import { csvSafe, downloadCsv, toCsv } from "@/utils/toCsv";

import { PacbioCaseModal } from "./PacbioCaseModal";
import { PacbioCaseRow } from "./PacbioCaseRow";
import { QcReviewSection } from "./QcReviewSection";
import { CellCaseRow, type RowExpansion } from "./QcCaseRow";
import {
  QC_CSV_HEADERS,
  type QcCase,
  qcCaseAge,
  qcCaseCellType,
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

function QcCaseItem({
  item,
  nowMs,
  overdueDays,
  ...expansion
}: { item: QcCase; nowMs: number; overdueDays: number | undefined } & RowExpansion) {
  const age = qcCaseAge(item, overdueDays, nowMs);
  return item.kind === "cell" ? (
    <CellCaseRow cell={item.cell} expected={qcCaseExpected(item)} age={age} {...expansion} />
  ) : (
    <PacbioCaseRow pacbioCase={item.pacbioCase} age={age} {...expansion} />
  );
}

function groupCases(items: QcCase[]): QcGroups {
  const g: QcGroups = { needs_report: [], awaiting: [], confirmed: [], received: [] };
  for (const item of items) g[creditBucket(qcCaseCredit(item))].push(item);
  const age = (i: QcCase) => qcCaseFailureMs(i) ?? 0;
  for (const b of OPEN_BUCKETS) g[b].sort((a, b2) => age(a) - age(b2));
  g.received.sort((a, b) => qcCaseReceivedMs(b) - qcCaseReceivedMs(a));
  return g;
}

/** The operations-manager glance: a row of totals across every case (never the search results).
 * Credited acquisitions are also shown as trays - PacBio's FOC tracker counts trays - converted
 * per case by its cell type (SPRQ-Nx: 1 cell = 3 acquisitions; single-use SPRQ: 1 cell = 1
 * acquisition; 4 cells a tray). SPRQ and SPRQ-Nx trays are different products, so once any SPRQ
 * credit exists the trays are shown per type. */
function OverviewStrip({
  items,
  groups,
  nowMs,
  overdueDays,
  toReview,
}: {
  items: QcCase[];
  groups: QcGroups;
  nowMs: number;
  overdueDays: number | undefined;
  /** Wells waiting in QC Review; null while MLWH is unavailable (unset, down or loading). */
  toReview: number | null;
}) {
  let overdue = 0;
  let pending = 0;
  let credited = 0;
  const creditedTrays: Record<CellType, number> = { sprq_nx: 0, sprq: 0 };
  for (const item of items) {
    const credit = qcCaseCredit(item);
    if (credit.pacbio_credit_confirmed_at) {
      const acq = credit.credit_acquisitions ?? 0;
      credited += acq;
      creditedTrays[qcCaseCellType(item)] += acquisitionsToTrays(acq, qcCaseCellType(item));
    } else if (!credit.credit_received_at) pending += qcCaseExpected(item) ?? 0;
    if (qcCaseAge(item, overdueDays, nowMs)?.overdue) overdue += 1;
  }
  const creditedTrayText =
    creditedTrays.sprq > 0
      ? `${formatQuantity(creditedTrays.sprq_nx)} SPRQ-Nx + ${formatQuantity(creditedTrays.sprq)} SPRQ tray`
      : `${formatQuantity(creditedTrays.sprq_nx)} tray`;
  const open = groups.needs_report.length + groups.awaiting.length + groups.confirmed.length;
  return (
    <Card>
      <CardBody>
        <StatTiles>
          <StatTile
            label="QC Review"
            value={toReview ?? "—"}
            title={
              toReview === null
                ? "SMRT cells the QC team failed in LangQC that RunNx hasn't - unavailable without MLWH"
                : "SMRT cells the QC team failed in LangQC that RunNx hasn't failed yet"
            }
          />
          <StatTile label="Open" value={open} title="Cases not yet received" />
          <StatTile
            label="Overdue"
            value={overdue > 0 ? <span className={styles.alertValue}>{overdue}</span> : overdue}
            title={
              overdueDays === undefined
                ? "Open cases stuck at one stage past the overdue limit (Settings › QC & credits)"
                : `Open cases stuck at one stage for more than ${overdueDays} days (Settings › QC & credits)`
            }
          />
          <StatTile label="Needs report" value={groups.needs_report.length} />
          <StatTile label="Awaiting PacBio" value={groups.awaiting.length} />
          <StatTile
            label="Confirmed"
            value={groups.confirmed.length}
            title="Credit confirmed by PacBio, not yet received"
          />
          <StatTile label="Received" value={groups.received.length} />
          <StatTile
            label="Acq pending"
            value={pending}
            title="Acquisitions expected back on open cases PacBio haven't confirmed yet"
          />
          <StatTile
            label="Acq credited"
            value={credited}
            hint={creditedTrayText}
            title="Acquisitions PacBio confirmed (confirmed + received cases). A SPRQ-Nx cell is 3 acquisitions, a single-use SPRQ cell is 1; either way 4 cells = 1 tray"
          />
        </StatTiles>
      </CardBody>
    </Card>
  );
}

/**
 * QC — the one home for every PacBio credit case: cells that Failed or were Stopped (they join
 * automatically) plus cases logged by hand without a cell (Add case without a cell). A row of
 * collapsible total tiles up top, a search + CSV export, then a worklist grouped by stage
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
  // What the last QC Review action did, so the well vanishing from the queue is never silent.
  const [reviewResolved, setReviewResolved] = useState<string | null>(null);
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

  const overdueDays = useOverdueDays();
  const cellsQuery = useQuery({
    queryKey: ["cells", { qc_status: "in_workflow" }],
    queryFn: () => cellsApi.listAll({ qc_status: "in_workflow" }),
  });
  const casesQuery = useQuery({ queryKey: ["pacbio-cases"], queryFn: pacbioCasesApi.list });
  // Reads MLWH, so it's cached a minute rather than refetched on every focus.
  const reviewQuery = useQuery({ queryKey: ["qc-review"], queryFn: qcApi.review, staleTime: 60_000 });

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
      <PageHeader
        help="qc"
        title="QC & PacBio credits"
        intro="SMRT cells the QC team failed that RunNx hasn't, then failed or stopped cells and cases logged by hand, chasing a credit back from PacBio."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={overviewOpen}
              onClick={toggleOverview}
              title="Totals across every case — your browser remembers whether they're shown"
            >
              {overviewOpen ? "Hide overview" : "Show overview"}
            </Button>
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
                setReviewResolved(null);
                setAddOpen(true);
              }}
              title="Log a PacBio credit case that isn't linked to any cell in RunNx"
            >
              + Add case without a cell
            </Button>
          </>
        }
      />

      {overviewOpen && loaded && (
        <OverviewStrip
          items={items}
          groups={allGroups}
          nowMs={nowMs}
          overdueDays={overdueDays}
          toReview={reviewQuery.data?.ok ? reviewQuery.data.pending.length : null}
        />
      )}

      {justAdded && (
        <Note tone="good" icon="✓">
          Added “{justAdded.summary}” as a case without a cell — it&apos;s in the list below, flagged{" "}
          <b>{NO_CELL_BADGE.label}</b>.
        </Note>
      )}

      {reviewResolved && (
        <Note tone="good" icon="✓">
          {reviewResolved}
        </Note>
      )}

      <QcReviewSection
        review={reviewQuery}
        query={query}
        onResolved={(text) => {
          setJustAdded(null);
          setReviewResolved(text);
        }}
      />

      {loading && <div className="status">Loading QC cases…</div>}
      {cellsQuery.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(cellsQuery.error, "Couldn't load the cells' QC cases.")}
        </Note>
      )}
      {casesQuery.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(casesQuery.error, "Couldn't load the cases logged without a cell.")}
        </Note>
      )}
      {loaded && items.length === 0 && (
        <Note tone="good" icon="✓">
          No PacBio credit cases right now — no cell has failed or been stopped, and no case without a cell has been
          logged.
        </Note>
      )}
      {loaded && items.length > 0 && searching && shown.length === 0 && (
        <div className="status">
          No cases match “{query.trim()}”. Search looks at the case number, internal report ID, owner, cell code or
          summary, run, sample and instrument.
        </div>
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
                <QcCaseItem
                  key={qcCaseKey(item)}
                  item={item}
                  nowMs={nowMs}
                  overdueDays={overdueDays}
                  {...expansion(item)}
                />
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
            <span className={showReceived ? "disclosure open" : "disclosure"} aria-hidden="true">
              ▸
            </span>
            {CREDIT_BUCKET_LABEL.received}
            <Badge tone={CREDIT_BUCKET_TONE.received}>{groups.received.length}</Badge>
          </button>
          {showReceived && (
            <div className={styles.rows}>
              {groups.received.map((item) => (
                <QcCaseItem
                  key={qcCaseKey(item)}
                  item={item}
                  nowMs={nowMs}
                  overdueDays={overdueDays}
                  {...expansion(item)}
                />
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
            setReviewResolved(null);
            setJustAdded(saved);
          }}
        />
      )}
    </div>
  );
}

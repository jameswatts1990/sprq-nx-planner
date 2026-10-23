import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
import { ABORTED_PRIORITY, RECOVERABLE_PRIORITY, REPEATABLE_PRIORITY } from "@/utils/priority";

import { AddSampleCard, DraggableSampleCard } from "./BacklogCards";
import styles from "./BacklogPanel.module.css";
import { SampleModal } from "../SampleModal";

/** The tray always lists the whole backlog (no pager) - fetched as one page at the API's
 * page_size cap (backend api/deps.py pagination, le=200), the same cap the header search uses.
 * A backlog bigger than this shows a "first 200 of N" note so nothing is silently hidden. */
const BACKLOG_LIST_LIMIT = 200;
/** Persist whether the pinned (top-position) backlog tray is open. Collapsed by default;
 * guarded so a locked-down browser (localStorage throwing) simply falls back to that default.
 * Only used by the top-position accordion — the side panel's collapse is owned by SchedulePage
 * (so the header search can force it open when it cycles to a backlog match). */
const OPEN_STORAGE_KEY = "runnx.schedule.backlogOpen";
export function readBacklogOpenPref(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeBacklogOpenPref(open: boolean): void {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore - persistence is a convenience, not a requirement */
  }
}

/** Priority values counted as "High priority or higher" for the header alert - rank 1 (High)
 * plus every rank-0 label (Aborted/Recoverable/Repeatable all sort ahead of High, see
 * utils/priority.ts). Passed as a comma-list to the /api/samples `priority` filter. */
const HIGH_OR_ABOVE_PRIORITIES = [RECOVERABLE_PRIORITY, REPEATABLE_PRIORITY, ABORTED_PRIORITY, "High (1)"].join(",");

const SORT_OPTIONS: { value: SampleSortBy; label: string }[] = [
  { value: "created_at", label: "Created" },
  { value: "pool_id", label: "Pool ID" },
  { value: "barcode", label: "Barcode" },
  { value: "priority", label: "Priority" },
];

export interface BacklogPanelProps {
  /** "top" = the pinned accordion tray under the toolbar (default); "left"/"right" = a docked,
   * collapsible side drawer one sample-card wide that pushes the grid aside. */
  mode: "top" | "left" | "right";
  /** Opens the Schedule page's Autoschedule drawer - rendered as the ✦ button in the header.
   * Omit to hide the button. */
  onOpenAutoschedule?: () => void;
  /** The debounced unified-search text (owned by the Schedule header's search box). When
   * non-empty the tray shows the text matches instead of the browsable, filtered list. */
  q: string;
  /** The samples matching `q`, already fetched by useScheduleSearch and passed down so the
   * tray's display order is exactly the search's cycle order (reliable scroll-to). Null when
   * not searching. */
  searchItems: SampleOut[] | null;
  searchTotal: number;
  searchLoading: boolean;
  /** The backlog sample the header search is currently cycled to - given a pulsing ring. */
  highlightSampleId: number | null;
  /** View options "Barcodes" toggle - adds each card's one-line barcode row. */
  showBarcodes: boolean;
  /** Top mode only: open/closed, lifted to SchedulePage so a backlog search match can force
   * the tray open. */
  open?: boolean;
  onToggleOpen?: (open: boolean) => void;
  /** Side mode only: collapsed to a thin rail, lifted to SchedulePage for the same reason. */
  collapsed?: boolean;
  onToggleCollapsed?: (collapsed: boolean) => void;
}

/** The Schedule page's backlog tray - a lightweight card list whose cards are drag sources,
 * over the same /api/samples backlog query the Backlog tab uses. Renders in two shapes from
 * one body of state: the pinned top accordion, or a docked one-card-wide side drawer. The
 * unified search box lives in the page header (not here); this panel just consumes its
 * debounced text and pre-fetched matches. */
export function BacklogPanel({
  mode,
  onOpenAutoschedule,
  q,
  searchItems,
  searchTotal,
  searchLoading,
  highlightSampleId,
  showBarcodes,
  open = false,
  onToggleOpen,
  collapsed = false,
  onToggleCollapsed,
}: BacklogPanelProps) {
  const searching = q.trim().length > 0;
  const isSide = mode === "left" || mode === "right";

  const [priority, setPriority] = useState("");
  // Defaults to priority order (High first) rather than created_at, so the most urgent
  // backlog samples surface without the user having to sort; matches the Backlog tab.
  const [sortBy, setSortBy] = useState<SampleSortBy>("priority");
  const [sortDir, setSortDir] = useState<SampleSortDir>("asc");
  // The Add/Edit sample modal (reused from the Backlog tab); the modal invalidates the
  // ["samples"] query on save, so both this list and the search matches refresh on their own.
  const [addOpen, setAddOpen] = useState(false);
  const [editSample, setEditSample] = useState<SampleOut | null>(null);

  // Whether the browse controls (priority filter, sort) are on screen - only then is
  // the priority list worth fetching. Hidden entirely while searching (the text search
  // supersedes them) and while the tray is closed/collapsed.
  const trayExpanded = isSide ? !collapsed : open;
  const controlsVisible = trayExpanded && !searching;
  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities", "backlog"],
    queryFn: () => samplesApi.listPriorities("backlog"),
    enabled: controlsVisible,
  });

  // Lightweight count-only checks (page_size 1, just reading .total) so the warning badges
  // stay live even while the tray is collapsed - the point is to flag urgent backlog samples
  // without the scheduler having to expand it first.
  const abortedQuery = useQuery({
    queryKey: ["samples", { status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }],
    queryFn: () => samplesApi.list({ status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }),
  });
  const abortedCount = abortedQuery.data?.total ?? 0;
  const highPriorityQuery = useQuery({
    queryKey: ["samples", { status: "backlog", priority: HIGH_OR_ABOVE_PRIORITIES, page: 1, page_size: 1 }],
    queryFn: () => samplesApi.list({ status: "backlog", priority: HIGH_OR_ABOVE_PRIORITIES, page: 1, page_size: 1 }),
  });
  const highPriorityCount = highPriorityQuery.data?.total ?? 0;

  // The browsable, filtered list - the tray's normal (not-searching) content. Runs even while
  // collapsed so the header count stays live. Skipped while searching, when the pre-fetched
  // search matches are shown instead.
  const browseQuery = useQuery({
    queryKey: ["samples", { status: "backlog", q: "", priority, sortBy, sortDir, page: 1, page_size: BACKLOG_LIST_LIMIT }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        priority: priority || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page: 1,
        page_size: BACKLOG_LIST_LIMIT,
      }),
    enabled: !searching,
  });

  const items = searching ? searchItems ?? [] : browseQuery.data?.items ?? [];
  const total = searching ? searchTotal : browseQuery.data?.total ?? 0;
  const listLoading = searching ? searchLoading : browseQuery.isLoading;
  const listError = searching ? null : browseQuery.error;

  const autoscheduleTitle = "Autoschedule — set the run design and auto-fill selected cells from the backlog";
  // Labelled in the roomy top header; a square pink ✦ icon in the narrow side header.
  const autoscheduleButton =
    onOpenAutoschedule &&
    (isSide ? (
      <Button variant="primary" size="sm" icon onClick={onOpenAutoschedule} aria-label="Open Autoschedule" title={autoscheduleTitle}>
        <span aria-hidden="true">✦</span>
      </Button>
    ) : (
      <Button variant="primary" size="sm" onClick={onOpenAutoschedule} aria-label="Open Autoschedule" title={autoscheduleTitle}>
        <span className={styles.sparkleIcon} aria-hidden="true">
          ✦
        </span>
        Autoschedule
      </Button>
    ));

  /** Priority filter + sort, shared by both layouts (a right-aligned group in the top header,
   * one compact row in the side drawer). Only rendered while browsing (not searching). */
  const browseControls = (
    <>
      <select
        className={styles.select}
        aria-label="Filter by priority"
        title="Filter by priority"
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">{isSide ? "All" : "All priorities"}</option>
        {(prioritiesQuery.data ?? []).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div className={styles.sortGroup}>
        <select
          className={styles.select}
          aria-label="Sort by"
          title="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SampleSortBy)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          title={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
        >
          {sortDir === "asc" ? "▲" : "▼"}
        </Button>
      </div>
    </>
  );

  const matchNote = searching && (
    <span className={styles.matchNote}>
      {total} match{total === 1 ? "" : "es"}
    </span>
  );

  const abortedTitle = `${abortedCount} aborted sample${abortedCount === 1 ? "" : "s"} back in the backlog after a stopped cell, waiting to be re-placed`;
  const highPriorityTitle = `${highPriorityCount} backlog sample${highPriorityCount === 1 ? "" : "s"} rated High priority or above (Aborted/Recoverable/Repeatable rank above High) that haven't been placed on the schedule yet`;

  // Top header: spelled-out warning badges + the count.
  const badge = (
    <span className={styles.badgeGroup}>
      {abortedCount > 0 && (
        <span title={abortedTitle}>
          <Badge tone="danger">⚠ {abortedCount} aborted</Badge>
        </span>
      )}
      {highPriorityCount > 0 && (
        <span title={highPriorityTitle}>
          <Badge tone="warning">⚠ {highPriorityCount} high priority+ unscheduled</Badge>
        </span>
      )}
      {searching ? `${total} match${total === 1 ? "" : "es"}` : `${total} sample${total === 1 ? "" : "s"}`}
    </span>
  );

  // Side header: the same warnings as compact ⚠N chips in the title row - colour says which
  // (red = aborted, amber = high priority+), the tooltip spells it out.
  const sideWarnings = (
    <>
      {abortedCount > 0 && (
        <span title={abortedTitle} aria-label={abortedTitle}>
          <Badge tone="danger">⚠{abortedCount}</Badge>
        </span>
      )}
      {highPriorityCount > 0 && (
        <span title={highPriorityTitle} aria-label={highPriorityTitle}>
          <Badge tone="warning">⚠{highPriorityCount}</Badge>
        </span>
      )}
    </>
  );

  // Only the first BACKLOG_LIST_LIMIT samples are fetched - say so rather than hide the rest.
  const truncatedNote = !searching && total > items.length && (
    <div className={styles.status}>
      Showing the first {items.length} of {total} — filter by priority to narrow.
    </div>
  );

  // The card list body, shared by both layouts. The trailing "+ Add sample" card is always
  // last, so the shortcut is there even when the list is empty or filtered to nothing.
  const cardList = (
    <>
      {listLoading && <div className={styles.status}>Loading backlog…</div>}
      {listError && (
        <Note tone="bad" icon="!">
          {listError instanceof ApiError ? listError.message : "Failed to load backlog."}
        </Note>
      )}
      {!listLoading && !listError && (
        <div className={isSide ? styles.column : styles.grid}>
          {items.length === 0 && (
            <div className={styles.status}>{searching ? "No matching samples." : "No backlog samples found."}</div>
          )}
          {items.map((sample) => (
            <DraggableSampleCard
              key={sample.id}
              sample={sample}
              onEdit={setEditSample}
              searchMatch={sample.id === highlightSampleId}
              showBarcodes={showBarcodes}
            />
          ))}
          {truncatedNote}
          <AddSampleCard onClick={() => setAddOpen(true)} />
        </div>
      )}
    </>
  );

  const modals = (
    <>
      {addOpen && <SampleModal onClose={() => setAddOpen(false)} />}
      {editSample && <SampleModal sample={editSample} onClose={() => setEditSample(null)} />}
    </>
  );

  // ── Side drawer ────────────────────────────────────────────────────────────────────────
  if (isSide) {
    const sideClasses = [styles.sidePanel];
    if (mode === "right") sideClasses.push(styles.right);
    if (collapsed) {
      return (
        <aside className={[...sideClasses, styles.collapsed].join(" ")} aria-label="Backlog" data-backlog-panel="">
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={() => onToggleCollapsed?.(false)}
            title="Expand the backlog panel"
            aria-label="Expand the backlog panel"
          >
            {mode === "right" ? "‹" : "›"}
          </button>
          <span className={styles.railLabel} aria-hidden="true">
            Backlog
          </span>
          {total > 0 && <span className={styles.railCount}>{total}</span>}
        </aside>
      );
    }
    return (
      <aside className={sideClasses.join(" ")} aria-label="Backlog" data-backlog-panel="">
        {/* Two rows: title + count + ⚠ chips + ✦ + collapse, then filter + sort (or the
            match count while the header search is active). */}
        <div className={styles.sideHeader}>
          <div className={styles.sideTitleRow}>
            <h2 className={styles.sideTitle}>Backlog</h2>
            {!searching && (
              <span className={styles.sideCount} title={`${total} backlog sample${total === 1 ? "" : "s"}`}>
                {total}
              </span>
            )}
            {sideWarnings}
            <span className={styles.sideSpacer} />
            {autoscheduleButton}
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={() => onToggleCollapsed?.(true)}
              title="Collapse the backlog panel"
              aria-label="Collapse the backlog panel"
            >
              {mode === "right" ? "›" : "‹"}
            </button>
          </div>
          {searching ? matchNote : <div className={styles.sideControls}>{browseControls}</div>}
        </div>
        <div className={styles.sideBody}>{cardList}</div>
        {modals}
      </aside>
    );
  }

  // ── Top accordion ──────────────────────────────────────────────────────────────────────
  return (
    <Accordion
      title="Backlog"
      open={open}
      onToggle={(next) => onToggleOpen?.(next)}
      titleAfter={
        <>
          {autoscheduleButton}
          {/* Filter / sort live in the header so the tray body is nothing but the scrollable
              card list. Only while open and not searching (the text search supersedes them). */}
          {open && (searching ? matchNote : <div className={styles.headControls}>{browseControls}</div>)}
        </>
      }
      badge={badge}
    >
      {cardList}
      {modals}
    </Accordion>
  );
}

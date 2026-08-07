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

const DEFAULT_PAGE_SIZE = 25;
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

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const SORT_OPTIONS: { value: SampleSortBy; label: string }[] = [
  { value: "created_at", label: "Created" },
  { value: "external_id", label: "Container ID" },
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
  open = false,
  onToggleOpen,
  collapsed = false,
  onToggleCollapsed,
}: BacklogPanelProps) {
  const searching = q.trim().length > 0;
  const isSide = mode === "left" || mode === "right";

  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Defaults to priority order (High first) rather than created_at, so the most urgent
  // backlog samples surface without the user having to sort; matches the Backlog tab.
  const [sortBy, setSortBy] = useState<SampleSortBy>("priority");
  const [sortDir, setSortDir] = useState<SampleSortDir>("asc");
  // The Add/Edit sample modal (reused from the Backlog tab); the modal invalidates the
  // ["samples"] query on save, so both this list and the search matches refresh on their own.
  const [addOpen, setAddOpen] = useState(false);
  const [editSample, setEditSample] = useState<SampleOut | null>(null);

  // Whether the browse controls (priority filter, sort, pager) are on screen - only then is
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

  // The browsable, filtered/paged list - the tray's normal (not-searching) content. Runs even
  // while collapsed so the header count badge stays live. Skipped while searching, when the
  // pre-fetched search matches are shown instead.
  const browseQuery = useQuery({
    queryKey: ["samples", { status: "backlog", q: "", priority, sortBy, sortDir, page, page_size: pageSize }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        priority: priority || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
    enabled: !searching,
  });

  const items = searching ? searchItems ?? [] : browseQuery.data?.items ?? [];
  const total = searching ? searchTotal : browseQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listLoading = searching ? searchLoading : browseQuery.isLoading;
  const listError = searching ? null : browseQuery.error;

  const autoscheduleButton = onOpenAutoschedule && (
    <Button
      variant="primary"
      size="sm"
      onClick={onOpenAutoschedule}
      aria-label="Open Autoschedule"
      title="Autoschedule — set the run design and auto-fill selected cells from the backlog"
    >
      <span className={styles.sparkleIcon} aria-hidden="true">
        ✦
      </span>
      Autoschedule
    </Button>
  );

  /** Priority filter + sort + rows-per-page + pager, shared by both layouts (the wrapping
   * container class differs: a right-aligned row in the top header, a vertical stack in the
   * side drawer). Only rendered while browsing (not searching). */
  const browseControls = (
    <>
      <select
        className={styles.select}
        aria-label="Filter by priority"
        title="Filter by priority"
        value={priority}
        onChange={(e) => {
          setPriority(e.target.value);
          setPage(1);
        }}
      >
        <option value="">All priorities</option>
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
          onChange={(e) => {
            setSortBy(e.target.value as SampleSortBy);
            setPage(1);
          }}
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
      {/* Rows-per-page + pager grouped so they stay on one row in the narrow side drawer
          (and sit together at the end of the top-header controls). */}
      <div className={styles.pageGroup}>
        <select
          className={styles.select}
          aria-label="Rows per page"
          title="Rows per page"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <div className={styles.pager}>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous page"
            title="Previous page"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ‹
          </Button>
          <span className={styles.pageInfo}>
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next page"
            title="Next page"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            ›
          </Button>
        </div>
      </div>
    </>
  );

  const matchNote = searching && (
    <span className={styles.matchNote}>
      {total} match{total === 1 ? "" : "es"}
    </span>
  );

  const badge = (
    <span className={styles.badgeGroup}>
      {abortedCount > 0 && <Badge tone="danger">⚠ {abortedCount} aborted</Badge>}
      {highPriorityCount > 0 && (
        <span title="Backlog samples rated High priority or above (Aborted/Recoverable/Repeatable rank above High) that haven't been placed on the schedule yet">
          <Badge tone="warning">⚠ {highPriorityCount} high priority+ unscheduled</Badge>
        </span>
      )}
      {searching ? `${total} match${total === 1 ? "" : "es"}` : `${total} sample${total === 1 ? "" : "s"}`}
    </span>
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
            />
          ))}
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
        <div className={styles.sideHeader}>
          <div className={styles.sideTitleRow}>
            <h2 className={styles.sideTitle}>Backlog</h2>
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
          {badge}
          {autoscheduleButton}
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
          {/* Filter / sort / pagination live in the header so the tray body is nothing but the
              scrollable card list. Only while open (a closed tray has no list to page) and not
              searching (the text search supersedes the browse controls). */}
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

import { useDraggable } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { sampleDragId } from "@/components/scheduler/gridKeys";
import type { SampleDragData } from "@/components/scheduler/useSchedulerDnd";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { ABORTED_PRIORITY, priorityLabel, priorityTone } from "@/utils/priority";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import { SampleModal } from "../SampleModal";
import styles from "./BacklogAccordion.module.css";

/** Default movie time shown when a sample has none (mirrors the backend's 24h default). */
const DEFAULT_MOVIE_HOURS = 24;

/** The palette var each priority tone maps to, for the card's left-edge accent. References
 * the same CSS custom properties the shared Badge tone map uses (see Badge.module.css) - a
 * pointer at the palette, not a forked colour value. */
const TONE_ACCENT_VAR: Record<BadgeTone, string> = {
  default: "var(--grey)",
  success: "var(--green)",
  danger: "var(--red)",
  warning: "var(--amber)",
  orange: "var(--orange)",
  info: "var(--blue-deep)",
  blue: "var(--blue)",
  purple: "var(--purple)",
};

const DEFAULT_PAGE_SIZE = 25;
/** Persist whether the pinned backlog tray is open, so a scheduler who works with it open
 * doesn't have to re-expand it on every visit. Collapsed by default; guarded so a locked-
 * down browser (localStorage throwing) simply falls back to that default. */
const OPEN_STORAGE_KEY = "runnx.schedule.backlogOpen";
function readOpenPref(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeOpenPref(open: boolean): void {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore - persistence is a convenience, not a requirement */
  }
}
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const SORT_OPTIONS: { value: SampleSortBy; label: string }[] = [
  { value: "created_at", label: "Created" },
  { value: "external_id", label: "Container ID" },
  { value: "barcode", label: "Barcode" },
  { value: "priority", label: "Priority" },
];

/** Draggable backlog sample card - doubles as the drag source for placing onto a slot.
 * Clicking the card (a plain click, not a drag - the PointerSensor's 5px activation distance
 * keeps the two apart, the same way a filled grid slot opens its detail on click) opens the
 * sample's detail page. Hovering (or keyboard-focusing the card) reveals an ✎ edit button
 * pinned top-right that opens the same Add/Edit modal the Backlog tab uses, so a scheduler can
 * fix a sample's details without leaving the grid. The button stops its own pointerdown/click
 * so editing never trips the drag sensor or the card's navigate. A movie-time chip and a
 * priority-tinted left edge make each card's run time and priority readable at a glance. */
function DraggableSampleCard({ sample, onEdit }: { sample: SampleOut; onEdit: (sample: SampleOut) => void }) {
  const navigate = useNavigate();
  const backNav = useSampleBackNav();
  const data: SampleDragData = {
    kind: "sample",
    sample: { id: sample.id, external_id: sample.external_id, barcodes: sample.barcodes },
  };
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: sampleDragId(sample.id), data });
  // Every card gets a priority-coloured left edge, defaulting to grey for Standard / no
  // priority - so the accent always reads as "this is its priority", never an absent chip.
  const accent = TONE_ACCENT_VAR[priorityTone(sample.priority)];
  const classes = [styles.card, styles.prioritised];
  if (isDragging) classes.push(styles.dragging);
  return (
    <div
      ref={setNodeRef}
      className={classes.join(" ")}
      style={{ ["--accent" as string]: accent }}
      title={`Open ${sample.external_id}`}
      onClick={() => navigate(`/samples/${sample.id}`, { state: backNav })}
      {...listeners}
      {...attributes}
    >
      <button
        type="button"
        className={styles.editBtn}
        aria-label={`Edit sample ${sample.external_id}`}
        title={`Edit ${sample.external_id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(sample);
        }}
      >
        <span aria-hidden="true">✎</span>
      </button>
      <div className={styles.cardHead}>
        <span className={styles.ext}>{sample.external_id}</span>
        {sample.parent_sample && <span className={styles.parent}>{sample.parent_sample}</span>}
        <Badge tone={priorityTone(sample.priority)}>{priorityLabel(sample.priority)}</Badge>
        <span className={styles.movie} title="Movie / acquisition time">
          ⏱ {sample.movie_time_hours ?? DEFAULT_MOVIE_HOURS} h
        </span>
      </div>
      <BarcodeChips barcodes={sample.barcodes} />
    </div>
  );
}

/** Dashed placeholder pinned as the last item in the card list - a shortcut to the same
 * "Add sample to backlog" modal the Backlog tab uses, so a scheduler can add a sample
 * inline without switching tabs. Not a drag source. */
function AddSampleCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.addCard} onClick={onClick} title="Add a new sample to the backlog">
      <span className={styles.addPlus} aria-hidden="true">
        +
      </span>
      Add sample
    </button>
  );
}

/** Collapsible backlog: a lightweight card list (cards are drag sources), same query
 * BacklogPage uses. Query runs even while collapsed so the header count stays live. */
export interface BacklogAccordionProps {
  /** Opens the Schedule page's Autoschedule drawer - rendered as the ✨ button pinned in
   * the Backlog header, right after the title. Omit to hide the button. */
  onOpenAutoschedule?: () => void;
}

export function BacklogAccordion({ onOpenAutoschedule }: BacklogAccordionProps = {}) {
  const [qInput, setQInput] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SampleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const [open, setOpen] = useState<boolean>(readOpenPref);
  // The Add/Edit sample modal (reused from the Backlog tab): `addOpen` for a brand-new
  // sample via the trailing "+" card, `editSample` for the ✎ button on a card. The modal
  // invalidates the ["samples"] query on save, so this list refreshes on its own.
  const [addOpen, setAddOpen] = useState(false);
  const [editSample, setEditSample] = useState<SampleOut | null>(null);
  const q = useDebouncedValue(qInput, 350);

  // Only feeds the priority-filter dropdown, which is rendered solely while the tray is open
  // (see the `open && (...)` header controls). Gated on `open` so a collapsed backlog on the
  // Schedule page - the default - doesn't fetch it. The two count queries below stay live
  // regardless, since their totals drive the always-visible header badges.
  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities", "backlog"],
    queryFn: () => samplesApi.listPriorities("backlog"),
    enabled: open,
  });

  // Lightweight count-only check (page_size 1, just reading .total) so the warning badge
  // stays visible even while the accordion is collapsed, same as the sample-count badge.
  const abortedQuery = useQuery({
    queryKey: ["samples", { status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }],
    queryFn: () => samplesApi.list({ status: "backlog", priority: ABORTED_PRIORITY, page: 1, page_size: 1 }),
  });
  const abortedCount = abortedQuery.data?.total ?? 0;

  const query = useQuery({
    queryKey: ["samples", { status: "backlog", q, priority, sortBy, sortDir, page, page_size: pageSize }],
    queryFn: () =>
      samplesApi.list({
        status: "backlog",
        q: q || undefined,
        priority: priority || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: pageSize,
      }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Accordion
      title="Backlog"
      open={open}
      onToggle={(next) => {
        setOpen(next);
        writeOpenPref(next);
      }}
      titleAfter={
        <>
          {onOpenAutoschedule && (
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
          )}
          {/* Search / filter / sort / pagination live in the header so the tray body is
              nothing but the scrollable card list — keeping the pinned backlog as short as
              possible over the grid. Only rendered while open (a collapsed tray has no list
              to search or page). */}
          {open && (
            <div className={styles.headControls}>
              <input
                type="search"
                className={styles.search}
                placeholder="Search…"
                aria-label="Search backlog by external ID, barcode, or parent sample"
                title="Search by external ID, barcode, or parent sample"
                value={qInput}
                onChange={(e) => {
                  setQInput(e.target.value);
                  setPage(1);
                }}
              />
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
          )}
        </>
      }
      badge={
        <span className={styles.badgeGroup}>
          {abortedCount > 0 && <Badge tone="danger">⚠ {abortedCount} aborted</Badge>}
          {`${total} sample${total === 1 ? "" : "s"}`}
        </span>
      }
    >
      {query.isLoading && <div className={styles.status}>Loading backlog…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load backlog."}
        </Note>
      )}
      {!query.isLoading && !query.isError && (
        <>
          {items.length === 0 && <div className={styles.status}>No backlog samples found.</div>}
          {/* The "+" add card is always the last item, so the shortcut is there even when the
              list is empty or filtered down to nothing. */}
          <div className={styles.grid}>
            {items.map((sample) => (
              <DraggableSampleCard key={sample.id} sample={sample} onEdit={setEditSample} />
            ))}
            <AddSampleCard onClick={() => setAddOpen(true)} />
          </div>
        </>
      )}

      {addOpen && <SampleModal onClose={() => setAddOpen(false)} />}
      {editSample && <SampleModal sample={editSample} onClose={() => setEditSample(null)} />}
    </Accordion>
  );
}

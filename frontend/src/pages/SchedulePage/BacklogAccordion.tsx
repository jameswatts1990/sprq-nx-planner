import { useDraggable } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import type { SampleSortBy, SampleSortDir } from "@/api/samples";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { sampleDragId } from "@/components/scheduler/gridKeys";
import type { SampleDragData } from "@/components/scheduler/useSchedulerDnd";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import type { SampleOut } from "@/types/sample";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { priorityTone } from "@/utils/priority";

import styles from "./BacklogAccordion.module.css";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS: SegmentedOption<number>[] = [25, 50, 100, 200].map((n) => ({
  value: n,
  label: String(n),
}));
const SORT_OPTIONS: SegmentedOption<SampleSortBy>[] = [
  { value: "created_at", label: "Created" },
  { value: "external_id", label: "External ID" },
  { value: "barcode", label: "Barcode" },
  { value: "priority", label: "Priority" },
];

/** Draggable backlog sample card - doubles as the drag source for placing onto a slot. */
function DraggableSampleCard({ sample }: { sample: SampleOut }) {
  const data: SampleDragData = {
    kind: "sample",
    sample: { id: sample.id, external_id: sample.external_id, barcodes: sample.barcodes },
  };
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: sampleDragId(sample.id), data });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? `${styles.card} ${styles.dragging}` : styles.card}
      {...listeners}
      {...attributes}
    >
      <div className={styles.cardHead}>
        <span className={styles.ext}>{sample.external_id}</span>
        {sample.parent_sample && <span className={styles.parent}>{sample.parent_sample}</span>}
        {sample.priority && <Badge tone={priorityTone(sample.priority)}>{sample.priority}</Badge>}
      </div>
      <BarcodeChips barcodes={sample.barcodes} />
    </div>
  );
}

/** Collapsible backlog: a lightweight card list (cards are drag sources), same query
 * BacklogPage uses. Query runs even while collapsed so the header count stays live. */
export function BacklogAccordion() {
  const [qInput, setQInput] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SampleSortBy>("created_at");
  const [sortDir, setSortDir] = useState<SampleSortDir>("desc");
  const q = useDebouncedValue(qInput, 350);

  const prioritiesQuery = useQuery({
    queryKey: ["samples", "priorities"],
    queryFn: () => samplesApi.listPriorities(),
  });

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
    <Accordion title="Backlog" badge={`${total} sample${total === 1 ? "" : "s"}`}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by external ID, barcode, or parent sample…"
          value={qInput}
          onChange={(e) => {
            setQInput(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={styles.select}
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
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          >
            {sortDir === "asc" ? "▲" : "▼"}
          </Button>
        </div>
        <SegmentedControl
          ariaLabel="Rows per page"
          options={PAGE_SIZE_OPTIONS}
          value={pageSize}
          onChange={(v) => {
            setPageSize(v);
            setPage(1);
          }}
        />
      </div>

      {query.isLoading && <div className={styles.status}>Loading backlog…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load backlog."}
        </Note>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <div className={styles.status}>No backlog samples found.</div>
      )}

      {items.length > 0 && (
        <>
          <div className={styles.grid}>
            {items.map((sample) => (
              <DraggableSampleCard key={sample.id} sample={sample} />
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </Accordion>
  );
}

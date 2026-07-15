import { useDraggable } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { samplesApi } from "@/api/samples";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Pagination } from "@/components/shared/Pagination";
import { sampleDragId } from "@/components/scheduler/gridKeys";
import type { SampleDragData } from "@/components/scheduler/useSchedulerDnd";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Note } from "@/components/ui/Note";
import type { SampleOut } from "@/types/sample";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { priorityTone } from "@/utils/priority";

import styles from "./BacklogAccordion.module.css";

const PAGE_SIZE = 25;

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
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(qInput, 350);

  const query = useQuery({
    queryKey: ["samples", { status: "backlog", q, page, page_size: PAGE_SIZE }],
    queryFn: () => samplesApi.list({ status: "backlog", q: q || undefined, page, page_size: PAGE_SIZE }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Accordion title="Backlog" badge={`${total} sample${total === 1 ? "" : "s"}`}>
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

import { useDraggable } from "@dnd-kit/core";
import { useNavigate } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { InsertSizeFlag } from "@/components/shared/InsertSizeFlag";
import { sampleDragId } from "@/components/scheduler/gridKeys";
import type { SampleDragData } from "@/components/scheduler/useSchedulerDnd";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type { SampleOut } from "@/types/sample";
import { priorityLabel, priorityTone } from "@/utils/priority";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import styles from "./BacklogCards.module.css";

/** Default movie time shown when a sample has none (mirrors the backend's 24h default). */
export const DEFAULT_MOVIE_HOURS = 24;

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

/** Draggable backlog sample card - doubles as the drag source for placing onto a slot.
 * Clicking the card (a plain click, not a drag - the PointerSensor's 5px activation distance
 * keeps the two apart, the same way a filled grid slot opens its detail on click) opens the
 * sample's detail page. Hovering (or keyboard-focusing the card) reveals an ✎ edit button
 * pinned top-right that opens the same Add/Edit modal the Backlog tab uses, so a scheduler can
 * fix a sample's details without leaving the grid. The button stops its own pointerdown/click
 * so editing never trips the drag sensor or the card's navigate. A movie-time chip and a
 * priority-tinted left edge make each card's run time and priority readable at a glance.
 * `searchMatch` flags the one card the Schedule page's unified search is cycled to - given a
 * pulsing ring and marked data-search-match so the page can scroll it into view. */
export function DraggableSampleCard({
  sample,
  onEdit,
  searchMatch = false,
}: {
  sample: SampleOut;
  onEdit: (sample: SampleOut) => void;
  searchMatch?: boolean;
}) {
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
  if (searchMatch) classes.push(styles.searchMatch);
  return (
    <div
      ref={setNodeRef}
      className={classes.join(" ")}
      style={{ ["--accent" as string]: accent }}
      title={`Open ${sample.external_id}`}
      onClick={() => navigate(`/samples/${sample.id}`, { state: backNav })}
      {...(searchMatch ? { "data-search-match": "true" } : {})}
      {...listeners}
      {...attributes}
    >
      <button
        type="button"
        className={`btn icon sm ${styles.editBtn}`}
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
        <DuplicateBadge index={sample.duplicate_index} total={sample.duplicate_total} />
        {sample.parent_sample && <span className={styles.parent}>{sample.parent_sample}</span>}
        <Badge tone={priorityTone(sample.priority)}>{priorityLabel(sample.priority)}</Badge>
        <span className={styles.movie} title="Movie / acquisition time">
          ⏱ {sample.movie_time_hours ?? DEFAULT_MOVIE_HOURS} h
        </span>
        <InsertSizeFlag sizeBp={sample.insert_size_bp} />
      </div>
      <BarcodeChips barcodes={sample.barcodes} />
    </div>
  );
}

/** Dashed placeholder pinned as the last item in the card list - a shortcut to the same
 * "Add sample to backlog" modal the Backlog tab uses, so a scheduler can add a sample
 * inline without switching tabs. Not a drag source. */
export function AddSampleCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.addCard} onClick={onClick} title="Add a new sample to the backlog">
      <span className={styles.addPlus} aria-hidden="true">
        +
      </span>
      Add sample
    </button>
  );
}

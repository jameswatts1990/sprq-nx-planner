import { useDraggable } from "@dnd-kit/core";
import { useNavigate } from "react-router-dom";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { InsertSizeFlag } from "@/components/shared/InsertSizeFlag";
import { MovieTimeFlag } from "@/components/shared/MovieTimeFlag";
import { sampleDragId } from "@/components/scheduler/gridKeys";
import type { SampleDragData } from "@/components/scheduler/useSchedulerDnd";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { useMovieRules } from "@/hooks/useMovieRules";
import type { SampleOut } from "@/types/sample";
import { priorityLabel, priorityShortLabel, priorityTone } from "@/utils/priority";
import { COMPLEX_REPEAT_WINDOW_DAYS, complexDaysLeft } from "@/utils/qcDisposition";
import { useSampleBackNav } from "@/utils/sampleBackNav";

import styles from "./BacklogCards.module.css";

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
  ink: "var(--ink)",
};

/** Draggable backlog sample card - doubles as the drag source for placing onto a slot.
 * Clicking the card (a plain click, not a drag - the PointerSensor's 5px activation distance
 * keeps the two apart, the same way a filled grid slot opens its detail on click) opens the
 * sample's detail page. Hovering (or keyboard-focusing the card) reveals an ✎ edit button
 * pinned top-right that opens the same Add/Edit modal the Backlog tab uses, so a scheduler can
 * fix a sample's details without leaving the grid. The button stops its own pointerdown/click
 * so editing never trips the drag sensor or the card's navigate. The movie time (a solid
 * MovieTimeFlag when it isn't the configured default) and a priority-tinted left edge make each
 * card's run time and priority readable at a glance.
 * `searchMatch` flags the one card the Schedule page's unified search is cycled to - given a
 * pulsing ring and marked data-search-match so the page can scroll it into view.
 * `showBarcodes` mirrors the Schedule page's View options "Barcodes" toggle. */
export function DraggableSampleCard({
  sample,
  onEdit,
  searchMatch = false,
  showBarcodes = true,
}: {
  sample: SampleOut;
  onEdit: (sample: SampleOut) => void;
  searchMatch?: boolean;
  showBarcodes?: boolean;
}) {
  const navigate = useNavigate();
  const backNav = useSampleBackNav();
  const data: SampleDragData = {
    kind: "sample",
    sample: { id: sample.id, pool_id: sample.pool_id },
  };
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: sampleDragId(sample.id), data });
  // Every card gets a priority-coloured left edge, defaulting to grey for Standard / no
  // priority - so the accent always reads as "this is its priority", never an absent chip.
  const accent = TONE_ACCENT_VAR[priorityTone(sample.priority)];
  // A sample with no movie time of its own runs for the configured default.
  const { defaultHours } = useMovieRules();
  const movieHours = sample.movie_time_hours ?? defaultHours;
  // Row 2 is reserved for priority | fragment size, so a "Repeatable — from complex" sample's
  // countdown (the ⌛ chip elsewhere) rides in the priority badge's tooltip instead.
  const complexLeft = complexDaysLeft(sample.qc_disposition, sample.qc_disposition_at);
  const priorityTitle =
    `Priority: ${priorityLabel(sample.priority)}` +
    (complexLeft == null
      ? ""
      : complexLeft >= 0
        ? ` · leftover complex: ${complexLeft}d left of ${COMPLEX_REPEAT_WINDOW_DAYS}`
        : ` · leftover complex: ${-complexLeft}d past the ${COMPLEX_REPEAT_WINDOW_DAYS}-day window`);
  const classes = [styles.card, styles.prioritised];
  if (isDragging) classes.push(styles.dragging);
  if (searchMatch) classes.push(styles.searchMatch);
  return (
    <div
      ref={setNodeRef}
      className={classes.join(" ")}
      style={{ ["--accent" as string]: accent }}
      title={`Open ${sample.pool_id}`}
      onClick={() => navigate(`/samples/${sample.id}`, { state: backNav })}
      {...(searchMatch ? { "data-search-match": "true" } : {})}
      {...listeners}
      {...attributes}
    >
      <button
        type="button"
        className={`btn icon sm ${styles.editBtn}`}
        aria-label={`Edit sample ${sample.pool_id}`}
        title={`Edit ${sample.pool_id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(sample);
        }}
      >
        <span aria-hidden="true">✎</span>
      </button>
      {/* Fixed rows (user-specified): 1 = the full Pool ID (never truncated - schedulers read
          the whole TRAC id), duplicate badge, movie time; 2 = priority | fragment size, nothing
          else (no Plate ID); 3 = the barcodes on one line ending in "…", only while the View
          options "Barcodes" toggle is on. */}
      <div className={styles.cardHead}>
        <span className={styles.ext}>{sample.pool_id}</span>
        <DuplicateBadge index={sample.duplicate_index} total={sample.duplicate_total} />
        {movieHours === defaultHours ? (
          <span className={styles.movie} title="Movie / acquisition time">
            ⏱ {movieHours} h
          </span>
        ) : (
          <span className={styles.movie}>
            <MovieTimeFlag hours={movieHours} />
          </span>
        )}
      </div>
      <div className={styles.cardSub}>
        <span title={priorityTitle}>
          <Badge tone={priorityTone(sample.priority)}>{priorityShortLabel(sample.priority)}</Badge>
        </span>
        <InsertSizeFlag sizeBp={sample.insert_size_bp} />
      </div>
      {showBarcodes && <BarcodeChips barcodes={sample.barcodes} singleLine />}
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

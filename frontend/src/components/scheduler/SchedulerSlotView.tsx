import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { classForUseIndex } from "@/utils/useIndexClass";

import styles from "./SchedulerSlotView.module.css";
import type { CellGhost } from "./waitingCells";

export interface SchedulerSlotViewProps extends HTMLAttributes<HTMLDivElement> {
  /** The filled well, or null for an empty slot placeholder. */
  stage: StageOut | null;
  /** 0-3; the physical well position within the day's run (unrelated to slot colour). */
  slotIndex: SlotIndex;
  /** Confirmed-run slot: no drag/remove affordance. */
  locked?: boolean;
  /** Mid-mutation: show the "placing…" shimmer. */
  placing?: boolean;
  /** A droppable slot currently being hovered by a drag. */
  over?: boolean;
  /** This filled slot is the active drag source. */
  dragging?: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. */
  selected?: boolean;
  /** Not a valid drop target for the drag currently in progress (cross-instrument move). */
  ineligible?: boolean;
  /** An empty slot that a waiting, reusable cell could be loaded into today - renders a
   * Use-N tinted placeholder instead of the plain "+" (see waitingCells.ts). Ignored when
   * `stage` is set. */
  ghost?: CellGhost;
}

/**
 * Pure presentational slot leaf - NO dnd-kit hooks - so it renders identically whether
 * driven interactively by SchedulerSlot in the grid, or read-only by RunDetailPage.
 * forwardRef + spread props let SchedulerSlot attach the droppable/draggable node ref
 * and listeners directly to this box.
 */
export const SchedulerSlotView = forwardRef<HTMLDivElement, SchedulerSlotViewProps>(function SchedulerSlotView(
  { stage, slotIndex, locked, placing, over, dragging, selected, ineligible, ghost, className, style, ...rest },
  ref,
) {
  // Colour groups by which physical cell is loaded (stage.use_number), not by well
  // position - so a cell reused across two wells in the same run shares one colour. A
  // ghost slot (no stage yet) colours by the use number it's waiting to become.
  const useClass = classForUseIndex(stage ? stage.use_number : ghost ? ghost.useNumber : slotIndex + 1);
  const classes = [styles.slot];
  if (stage) {
    classes.push(styles.filled, styles[useClass]);
  } else if (ghost) {
    classes.push(styles.ghost, styles[useClass]);
    if (ghost.isHardCutoff) classes.push(styles.ghostCutoff);
  } else {
    classes.push(styles.empty);
  }
  if (locked) classes.push(styles.locked);
  if (placing) classes.push(styles.placing);
  if (over) classes.push(styles.over);
  if (dragging) classes.push(styles.dragging);
  if (selected) classes.push(styles.selected);
  if (ineligible) classes.push(styles.ineligible);
  if (className) classes.push(className);

  // Fade intensity only applies to the calm (non-cutoff) ghost look - the cutoff variant
  // is a fixed, fully-opaque "act now" style regardless of how the fade would otherwise sit.
  const mergedStyle: CSSProperties | undefined =
    ghost && !ghost.isHardCutoff ? { ...style, ["--ghost-opacity" as string]: ghost.fadeOpacity } : style;

  return (
    <div ref={ref} className={classes.join(" ")} style={mergedStyle} {...rest}>
      {stage ? (
        <>
          <div className={styles.ext} title={stage.sample_external_id ?? stage.cell_ref}>
            {stage.sample_external_id ?? "—"}
          </div>
          <div className={styles.cellref}>{stage.cell_ref}</div>
          <BarcodeChips barcodes={stage.barcodes} variant={useClass} />
        </>
      ) : ghost ? (
        <>
          <div className={styles.ghostCode} title={ghost.cell.code}>
            {ghost.cell.code}
          </div>
          <div className={styles.ghostLabel}>
            {ghost.isHardCutoff
              ? `Use ${ghost.useNumber} · expires today`
              : `Use ${ghost.useNumber} · by ${formatShortDateUTC(parseDateOnly(ghost.cutoffDate))}`}
          </div>
        </>
      ) : (
        <span className={styles.placeholder}>{placing ? "placing…" : "+"}</span>
      )}
      {stage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
});

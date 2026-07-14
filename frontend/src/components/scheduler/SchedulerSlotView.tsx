import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { classForUseIndex } from "@/utils/useIndexClass";

import styles from "./SchedulerSlotView.module.css";

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
}

/**
 * Pure presentational slot leaf - NO dnd-kit hooks - so it renders identically whether
 * driven interactively by SchedulerSlot in the grid, or read-only by RunDetailPage.
 * forwardRef + spread props let SchedulerSlot attach the droppable/draggable node ref
 * and listeners directly to this box.
 */
export const SchedulerSlotView = forwardRef<HTMLDivElement, SchedulerSlotViewProps>(function SchedulerSlotView(
  { stage, slotIndex, locked, placing, over, dragging, selected, ineligible, className, ...rest },
  ref,
) {
  // Colour groups by which physical cell is loaded (stage.use_number), not by well
  // position - so a cell reused across two wells in the same run shares one colour.
  const useClass = classForUseIndex(stage ? stage.use_number : slotIndex + 1);
  const classes = [styles.slot];
  if (stage) {
    classes.push(styles.filled, styles[useClass]);
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

  return (
    <div ref={ref} className={classes.join(" ")} {...rest}>
      {stage ? (
        <>
          <div className={styles.ext} title={stage.sample_external_id ?? stage.cell_ref}>
            {stage.sample_external_id ?? "—"}
          </div>
          <div className={styles.cellref}>{stage.cell_ref}</div>
          <BarcodeChips barcodes={stage.barcodes} variant={useClass} />
        </>
      ) : (
        <span className={styles.placeholder}>{placing ? "placing…" : "+"}</span>
      )}
      {stage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
});

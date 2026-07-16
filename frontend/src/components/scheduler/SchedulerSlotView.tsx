import { forwardRef, memo } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { classForUseIndex } from "@/utils/useIndexClass";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

import styles from "./SchedulerSlotView.module.css";
import { CELL_LINK_SLOT_ATTR } from "./useCellLinkHighlight";
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
  /** This filled slot is the active drag source - rendered as if unplaced (dashed
   * placeholder, or its ghost if one applies), matching what dropping it outside the
   * grid would actually do. */
  dragging?: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. */
  selected?: boolean;
  /** Not a valid drop target for the drag currently in progress (cross-instrument move). */
  ineligible?: boolean;
  /** An empty slot that a waiting, reusable cell could be loaded into today - renders a
   * Use-N tinted placeholder instead of the plain "+" (see waitingCells.ts). Ignored when
   * `stage` is set. */
  ghost?: CellGhost;
  /** This is the exact slot currently hovered/pinned for the cross-time same-cell link
   * highlight (see useCellLinkHighlight.tsx). */
  linkSource?: boolean;
  /** A different slot sharing the same cell_id as the active hover/pin target. */
  linked?: boolean;
  /** A hover/pin target is active and this slot is neither the source nor a peer. */
  dimmed?: boolean;
}

/**
 * Pure presentational slot leaf - NO dnd-kit hooks - so it renders identically whether
 * driven interactively by SchedulerSlot in the grid, or read-only by RunDetailPage.
 * forwardRef + spread props let SchedulerSlot attach the droppable/draggable node ref
 * and listeners directly to this box.
 */
export const SchedulerSlotView = memo(
  forwardRef<HTMLDivElement, SchedulerSlotViewProps>(function SchedulerSlotView(
    {
      stage,
      slotIndex,
      locked,
      placing,
      over,
      dragging,
      selected,
      ineligible,
      ghost,
      linkSource,
      linked,
      dimmed,
      className,
      style,
      ...rest
    },
    ref,
  ) {
  // While this filled slot is being dragged, treat it as unplaced for rendering purposes -
  // it reads as an empty/ghost placeholder, same as it will actually be if the drag ends
  // outside a valid drop target (see useSchedulerDnd's onDragEnd).
  const showStage = !!stage && !dragging;

  // Surfaces a QC problem directly on the grid, independent of the Use 1/2/3 tint.
  // "cancelled" (this exact use was wiped out when its cell was stopped before it could
  // run - see placement_service/cell_service) takes priority over the plain whole-cell
  // "stopped" ring, since it's a distinct, more specific claim ("this never happened" vs
  // "this cell is generally out of service"); stopped in turn outranks a merely-
  // failed/aborted use, being the more severe, whole-cell condition. Any of these can
  // coexist with a normal-looking completed/planned use elsewhere on the same cell.
  const qcAlert: "cancelled" | "stopped" | "failed" | "aborted" | null = !showStage
    ? null
    : stage!.cell_use_status === "cancelled"
      ? "cancelled"
      : stage!.cell_status === "stopped"
        ? "stopped"
        : stage!.cell_use_status === "failed"
          ? "failed"
          : stage!.cell_use_status === "aborted"
            ? "aborted"
            : null;

  // Colour groups by which physical cell is loaded (stage.use_number), not by well
  // position - so a cell reused across two wells in the same run shares one colour. A
  // ghost slot (no stage yet) colours by the use number it's waiting to become.
  const useClass = classForUseIndex(showStage ? stage!.use_number : ghost ? ghost.useNumber : slotIndex + 1);
  const classes = [styles.slot];
  if (showStage) {
    classes.push(styles.filled, styles[useClass]);
    // Cancelled gets its own yellow "blocked" cross-hatch (this use never happened at
    // all, distinct from a recorded outcome). Aborted is a run/instrument problem, not a
    // cell-quality one, so it gets the milder amber "warning" treatment - Failed/Stopped
    // (a real cell-quality concern) keep red.
    if (qcAlert === "cancelled") classes.push(styles.qcAlertCancelled);
    else if (qcAlert === "aborted") classes.push(styles.qcAlertWarn);
    else if (qcAlert) classes.push(styles.qcAlert);
    // Shades toward the same fade as a waiting-cell ghost, but driven by this cell's own
    // elapsed time rather than time-to-deadline - "denote the passing of time until a
    // [cell's] expiry" (see docs/pacbio-sprq-nx-scheduling-reference.md #2: this is always
    // per-cell, never a shared tray-level clock).
    if (stage!.window_hours_elapsed !== null) classes.push(styles.windowShaded);
  } else if (ghost) {
    classes.push(styles.ghost, styles[useClass]);
    if (ghost.isHardCutoff) classes.push(styles.ghostCutoff);
    if (ghost.unused) classes.push(styles.ghostUnused);
  } else {
    classes.push(styles.empty);
  }
  if (locked) classes.push(styles.locked);
  if (placing) classes.push(styles.placing);
  // Hovering directly over a ghost previews an exact-match reuse of that specific cell -
  // a distinct highlight from the generic "valid drop target" look, which is reserved for
  // drops that still need the cell-choice popup (e.g. the plain "+" placeholder).
  if (over) classes.push(ghost ? styles.ghostOver : styles.over);
  if (dragging) classes.push(styles.dragging);
  if (selected) classes.push(styles.selected);
  if (ineligible) classes.push(styles.ineligible);
  if (linkSource) classes.push(styles.linkSource);
  else if (linked) classes.push(styles.linkPeer);
  if (dimmed) classes.push(styles.dimmed);
  if (className) classes.push(className);

  // Fade intensity only applies to the calm (non-cutoff) ghost look - the cutoff variant
  // is a fixed, fully-opaque "act now" style regardless of how the fade would otherwise sit.
  let mergedStyle: CSSProperties | undefined =
    ghost && !ghost.isHardCutoff ? { ...style, ["--ghost-opacity" as string]: ghost.fadeOpacity } : style;
  if (showStage && stage!.window_hours_elapsed !== null) {
    const hoursRemaining = CELL_LIFETIME_H - stage!.window_hours_elapsed;
    mergedStyle = { ...mergedStyle, ["--window-opacity" as string]: expiryFadeOpacity(hoursRemaining) };
  }

  return (
    <div
      ref={ref}
      className={classes.join(" ")}
      style={mergedStyle}
      {...(showStage ? { [CELL_LINK_SLOT_ATTR]: "" } : {})}
      {...rest}
    >
      {showStage ? (
        <>
          <div className={styles.ext} title={stage!.sample_external_id ?? stage!.cell_ref}>
            {stage!.sample_external_id ?? "—"}
          </div>
          <div className={styles.cellref}>{stage!.cell_ref}</div>
          {stage!.tray_position !== null && (
            <div className={styles.trayTag} title="Position within this cell's physical SPRQ-Nx SMRT Cell tray of 4">
              Tray {stage!.tray_position}/4
            </div>
          )}
          {qcAlert && (
            <div
              className={
                qcAlert === "cancelled"
                  ? styles.qcAlertLabelCancelled
                  : qcAlert === "aborted"
                    ? styles.qcAlertLabelWarn
                    : styles.qcAlertLabel
              }
              title={
                qcAlert === "cancelled"
                  ? "Blocked - this placement was cancelled when its cell was stopped before it could run. Its sample went back to the Backlog."
                  : qcAlert === "stopped"
                    ? "This physical cell has been stopped - out of service, never reused."
                    : qcAlert === "failed"
                      ? "This use was marked Failed - no usable data produced."
                      : "This use was marked Aborted - the run/instrument was the problem, sample back in the backlog."
              }
            >
              {qcAlert === "cancelled" ? "Blocked" : qcAlert === "stopped" ? "Stopped" : qcAlert === "failed" ? "Failed" : "Aborted"}
            </div>
          )}
          <BarcodeChips barcodes={stage!.barcodes} variant={useClass} />
          {(linkSource || linked) && (
            <span
              className={linkSource ? styles.linkBadgeSource : styles.linkBadgePeer}
              aria-hidden="true"
            />
          )}
        </>
      ) : ghost ? (
        <>
          <div className={styles.ghostCode} title={ghost.cell.code}>
            {ghost.cell.code}
          </div>
          <div className={styles.ghostLabel}>
            {ghost.unused
              ? "Not yet used"
              : ghost.isHardCutoff
                ? `Use ${ghost.useNumber} · expires today`
                : `Use ${ghost.useNumber} · by ${formatShortDateUTC(parseDateOnly(ghost.cutoffDate))}`}
          </div>
        </>
      ) : (
        <span className={styles.placeholder}>{placing ? "placing…" : dragging ? "" : "+"}</span>
      )}
      {showStage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
  }),
);

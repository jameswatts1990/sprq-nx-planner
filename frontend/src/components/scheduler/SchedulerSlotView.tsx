import { forwardRef, memo } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { classForUseIndex } from "@/utils/useIndexClass";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

import styles from "./SchedulerSlotView.module.css";
import { CELL_LINK_SLOT_ATTR } from "./useCellLinkHighlight";
import type { CellGhost } from "./waitingCells";

export interface SchedulerSlotViewProps extends HTMLAttributes<HTMLDivElement> {
  /** The filled well, or null for an empty slot placeholder. */
  stage: StageOut | null;
  /** Grid position 0-7 within the run: Plate 1 -> 0-3, Plate 2 -> 4-7 (unrelated to slot colour). */
  slotIndex: SlotIndex;
  /** Confirmed-run slot: no drag/remove affordance. */
  locked?: boolean;
  /** Mid-mutation: show the "placing…" shimmer. */
  placing?: boolean;
  /** A droppable slot currently being hovered by a drag. Combined with `dragging` this is
   * the drag's own origin slot being hovered again - a no-op drop, previewed distinctly
   * from a dropped-elsewhere eviction (see .noopOver). */
  over?: boolean;
  /** This filled slot is the active drag source - rendered as if unplaced (dashed
   * placeholder, or its ghost if one applies), matching what dropping it outside the
   * grid would actually do (unless also `over` - see above). */
  dragging?: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. */
  selected?: boolean;
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
  /** This well is permanently blocked by a stopped cell - greyed out with a cross instead
   * of the plain "+", since placing a new cell here isn't possible. Ignored when `stage`
   * or `ghost` is set. */
  blocked?: boolean;
  /** Opens the in-grid cell-info popover for this placement's physical cell. When set (and
   * a stage is shown), the card renders a clickable "ticket stub" on its right edge - the
   * physical cell + its use number. Distinct from the card-body click, which opens the
   * sample/slot detail. Wired from SchedulerSlot with the stage's own cell bound. */
  onOpenCell?: () => void;
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
      ghost,
      linkSource,
      linked,
      dimmed,
      blocked,
      onOpenCell,
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

  // The only ghost this view ever renders now is a SPENT-well marker (a terminal cell still
  // physically occupying its well - see SchedulerSlot, which only forwards a terminalStatus
  // ghost here). Reuse offers are no longer painted as cards: a well with a reusable resident
  // cell reads as a plain droppable "+", and the resident's id rides along as the drop's
  // ghostCellId so a drop lands on its sequential next use (see SchedulerSlot.DroppableSlot).
  const renderGhost = ghost;

  // Surfaces a QC problem directly on the grid, independent of the Use 1/2/3 tint. A
  // use's own recorded outcome (cancelled/failed/aborted) always wins over the whole-cell
  // "stopped" flag - stopping a cell only cuts off its *future* (see cell_service.
  // stop_cell), so an earlier use that already finished, failed, or was aborted keeps
  // showing that true history instead of being repainted "Stopped" just because the same
  // physical cell was taken out of service later. "stopped" is only shown as a fallback
  // for a use that has no outcome of its own yet (still "planned"/"started") AND the cell
  // has no failed use anywhere - stop_cell() always marks its triggering use "failed", so
  // cell_has_failed_use being true means some other use on this cell already carries the
  // real, specific outcome and this one is provably just untouched history, not the one
  // cut short (see StageOut.cell_has_failed_use). Any of these can coexist with a
  // normal-looking completed/planned use elsewhere on the same cell.
  const qcAlert: "cancelled" | "stopped" | "failed" | "aborted" | null = !showStage
    ? null
    : stage!.cell_use_status === "cancelled"
      ? "cancelled"
      : stage!.cell_use_status === "failed"
        ? "failed"
        : stage!.cell_use_status === "aborted"
          ? "aborted"
          : stage!.cell_use_status !== "completed" && stage!.cell_status === "stopped" && !stage!.cell_has_failed_use
            ? "stopped"
            : null;

  // Colour groups by which physical cell is loaded (stage.use_number), not by well
  // position - so a cell reused across two wells in the same run shares one colour.
  const useClass = classForUseIndex(showStage ? stage!.use_number : slotIndex + 1);
  // The right-edge cell "ticket stub": physical column (well letter) + use number, e.g. "A2",
  // colour-coded by use (solid Use 1/2/3 palette, like the legend swatches). Only rendered on
  // a filled card that has an onOpenCell handler.
  const showStub = showStage && !!onOpenCell;
  const stubLabel = showStage ? `${stage!.well.charAt(0)}${stage!.use_number}` : "";
  const stubClass = !showStage
    ? ""
    : stage!.use_number >= 3
      ? styles.stubU3
      : stage!.use_number === 2
        ? styles.stubU2
        : styles.stubU1;
  // Holographic "security seal" identity: every physical cell gets its own look, so the same
  // well+use label (e.g. "A1") on two different days reads as two DIFFERENT physical cells at a
  // glance. Two independent, deterministic signals both keyed off the cell:
  //   - a per-cell hue rotation of the iridescent sheen (golden-angle spread so adjacent cell
  //     ids land far apart on the wheel), and
  //   - the cell's own short id printed as repeating microtext down the seal (like the
  //     micro-lettering on a real holographic security sticker).
  // The Use 1/2/3 base colour is untouched underneath, so the use number still reads normally.
  const sealNum = showStage
    ? (stage!.cell_ref?.match(/(\d+)\s*$/)?.[1]?.replace(/^0+/, "") ?? "") || String(stage!.cell_id)
    : "";
  const sealHue = showStage ? Math.round((stage!.cell_id * 137.508) % 360) : 0;
  // Repeated enough to fill the seal's height; overflow-hidden clips the tail.
  const sealMicrotext = sealNum ? `${sealNum} · `.repeat(8).trim() : "";
  const classes = [styles.slot];
  if (showStage) {
    classes.push(styles.filled, styles[useClass]);
    // Severity scale, lightest to most severe: Aborted (run/instrument problem, not a
    // cell-quality one) gets the mildest amber/yellow "warning" treatment; Failed (a real
    // cell-quality concern, but this one physical cell may still be fine otherwise) gets
    // its own distinct orange, between warning and danger; Stopped and Cancelled/"Blocked"
    // (a future use lost because the whole cell was taken out of service) share the same
    // red "danger" severity, since both mean this physical cell is permanently done.
    if (qcAlert === "cancelled") classes.push(styles.qcAlertCancelled);
    else if (qcAlert === "aborted") classes.push(styles.qcAlertWarn);
    else if (qcAlert === "failed") classes.push(styles.qcAlertFailed);
    else if (qcAlert) classes.push(styles.qcAlert);
    // Shades toward the same fade as a waiting-cell ghost, but driven by this cell's own
    // elapsed time rather than time-to-deadline - "denote the passing of time until a
    // [cell's] expiry" (see docs/pacbio-sprq-nx-scheduling-reference.md #2: this is always
    // per-cell, never a shared tray-level clock).
    if (stage!.window_hours_elapsed !== null) classes.push(styles.windowShaded);
  } else if (renderGhost?.terminalStatus) {
    // A well physically holding a spent cell (its tray hasn't left the instrument yet) can't
    // take a placement - rendered as the SAME minimal, non-droppable "spent well" marker as a
    // stopped well (styles.blocked), never a sample-like card. It just isn't a loadable well
    // right now; the specific reason lives in the tooltip.
    classes.push(styles.blocked);
  } else if (blocked) {
    classes.push(styles.blocked);
  } else {
    classes.push(styles.empty);
  }
  if (locked) classes.push(styles.locked);
  if (placing) classes.push(styles.placing);
  if (showStub) classes.push(styles.hasStub);
  if (over) {
    if (dragging) {
      // Hovering back over the exact slot a drag started from - dropping here changes
      // nothing, so it gets a calm, neutral look rather than either "valid new
      // placement" (.over) or "will swap" (.swapOver).
      classes.push(styles.noopOver);
    } else if (showStage) {
      // Hovering a dragged, already-placed sample over a *different* occupied slot
      // previews a swap - layered on top of the target's own Use-N tint, not replacing
      // it, so the sample about to be displaced stays visible underneath.
      classes.push(styles.swapOver);
    } else {
      // Hovering a valid drop target - a plain "+" well ready to take this sample.
      classes.push(styles.over);
    }
  }
  if (dragging) classes.push(styles.dragging);
  if (selected) classes.push(styles.selected);
  if (linkSource) classes.push(styles.linkSource);
  else if (linked) classes.push(styles.linkPeer);
  if (dimmed) classes.push(styles.dimmed);
  if (className) classes.push(className);

  let mergedStyle: CSSProperties | undefined = style;
  if (showStage && stage!.window_hours_elapsed !== null) {
    const hoursRemaining = CELL_LIFETIME_H - stage!.window_hours_elapsed;
    mergedStyle = { ...mergedStyle, ["--window-opacity" as string]: expiryFadeOpacity(hoursRemaining) };
  }

  // Why this well is dead. A terminal ghost only ever renders while at least one sibling in
  // the same physical tray still holds real capacity (waitingCells.computeTerminalGhost
  // stops returning one at all, in favour of a plain droppable "+", the moment every sibling
  // has also gone terminal - see computeVacatedTrayIds), so this well always stays locked
  // for as long as this marker is visible.
  const terminalGhostTitle = renderGhost?.terminalStatus
    ? `${
        renderGhost.terminalStatus === "exhausted"
          ? "This cell has used up all its lawful uses."
          : renderGhost.terminalStatus === "window_expired"
            ? "This cell's 108-hour window closed before its remaining capacity could be used."
            : "This cell was manually retired."
      } This well stays locked until every cell in its physical tray is also used up, expired, or retired - the tray is still loaded on the instrument.`
    : undefined;

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
          {qcAlert && (
            <div
              className={
                qcAlert === "cancelled"
                  ? styles.qcAlertLabelCancelled
                  : qcAlert === "aborted"
                    ? styles.qcAlertLabelWarn
                    : qcAlert === "failed"
                      ? styles.qcAlertLabelFailed
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
          {showStub && (
            // stopPropagation on pointer-down AND click so tapping the stub opens cell info
            // without also starting a dnd-kit drag or firing the card's open-slot-detail click.
            <button
              type="button"
              className={`${styles.stub} ${stubClass}`}
              style={{ [("--seal-hue") as string]: `${sealHue}deg` }}
              title={`Cell ${stage!.cell_ref} · Use ${stage!.use_number} of 3 — click for cell details`}
              aria-label={`Cell ${stage!.cell_ref}, use ${stage!.use_number}. Open cell details.`}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCell!();
              }}
            >
              <span className={styles.stubSheen} aria-hidden="true" />
              <span className={styles.stubMicro} aria-hidden="true">
                {sealMicrotext}
              </span>
              <span className={styles.stubLabel}>{stubLabel}</span>
            </button>
          )}
          {(linkSource || linked) && (
            <span
              className={linkSource ? styles.linkBadgeSource : styles.linkBadgePeer}
              aria-hidden="true"
            />
          )}
        </>
      ) : renderGhost?.terminalStatus ? (
        <span className={styles.blockedIcon} title={terminalGhostTitle} aria-hidden="true">
          ✕
        </span>
      ) : blocked ? (
        <span
          className={styles.blockedIcon}
          title="This well is blocked - its cell was stopped and can't be reused here"
          aria-hidden="true"
        >
          ✕
        </span>
      ) : (
        <span
          className={styles.placeholder}
          title={locked && !placing ? "This run is locked - it can't accept new placements or moves." : undefined}
        >
          {placing ? "placing…" : dragging ? (over ? "stays here" : "") : "+"}
        </span>
      )}
      {showStage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
  }),
);

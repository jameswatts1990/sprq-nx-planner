import { forwardRef, memo } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { CELL_STATUS_LABEL } from "@/utils/cellStatus";
import { classForUseIndex } from "@/utils/useIndexClass";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

import styles from "./SchedulerSlotView.module.css";
import { CELL_LINK_SLOT_ATTR } from "./useCellLinkHighlight";
import type { CellGhost } from "./waitingCells";

// Severity-coded per terminalStatus reason (see CellGhost.terminalStatus/CELL_STATUS_TONE):
// exhausted and window_expired share the same red severity (same as a QC problem
// elsewhere on the grid) - both mean this physical cell's lawful capacity is gone, whether
// spent in full or left on the table when its 108h window shut. retired is a deliberate
// manual write-off (amber), a step milder since nothing was "lost" unexpectedly.
const TERMINAL_STATUS_CLASS: Record<"exhausted" | "window_expired" | "retired", string> = {
  exhausted: styles.terminalExhausted,
  window_expired: styles.terminalExpired,
  retired: styles.terminalRetired,
};

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
  /** This well is permanently blocked by a stopped cell - greyed out with a cross instead
   * of the plain "+", since placing a new cell here isn't possible. Ignored when `stage`
   * or `ghost` is set. */
  blocked?: boolean;
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
      blocked,
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
  // position - so a cell reused across two wells in the same run shares one colour. A
  // ghost slot (no stage yet) colours by the use number it's waiting to become.
  const useClass = classForUseIndex(showStage ? stage!.use_number : ghost ? ghost.useNumber : slotIndex + 1);
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
  } else if (ghost) {
    classes.push(styles.ghost);
    if (ghost.terminalStatus) {
      // Neutral/severity-coded by *why* it went terminal, never tinted by use number -
      // this cell is done, so it must never read as a live Use 1/2/3 chip.
      classes.push(styles.ghostTerminal, TERMINAL_STATUS_CLASS[ghost.terminalStatus]);
    } else if (ghost.pendingTerminalStatus) {
      // Already fully booked (every remaining use scheduled) but not yet actually at that
      // state as of this column's day - a calmer, informational look, distinct from both
      // the red terminal severity above and the actionable Use-N tint below, since this
      // well is neither dead nor a live drop target.
      classes.push(styles.ghostPending);
    } else if (ghost.unused) {
      // Muted grey, not tinted by use number - it hasn't been used yet, so colouring it
      // like a real Use 1 (which .u1.ghost's higher-specificity two-class selector would
      // otherwise win over this single class regardless of declaration order) reads as
      // "this is already Use 1" and clashes with the real Use 1 tint elsewhere on the grid.
      classes.push(styles.ghostUnused);
    } else {
      classes.push(styles[useClass]);
      if (ghost.isHardCutoff) classes.push(styles.ghostCutoff);
    }
  } else if (blocked) {
    classes.push(styles.blocked);
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

  // Why this well is dead. A terminal ghost only ever renders while at least one sibling in
  // the same physical tray still holds real capacity (waitingCells.computeTerminalGhost
  // stops returning one at all, in favour of a plain droppable "+", the moment every sibling
  // has also gone terminal - see computeVacatedTrayIds), so this well always stays locked
  // for as long as this marker is visible.
  const terminalGhostTitle = ghost?.terminalStatus
    ? `${
        ghost.terminalStatus === "exhausted"
          ? "This cell has used up all its lawful uses."
          : ghost.terminalStatus === "window_expired"
            ? "This cell's 108-hour window closed before its remaining capacity could be used."
            : "This cell was manually retired."
      } This well stays locked until every cell in its physical tray is also used up, expired, or retired - the tray is still loaded on the instrument.`
    : undefined;

  // Every remaining use of this cell is already scheduled for a later day, so this well
  // can't be picked for a new placement - but it hasn't actually reached the end of its own
  // lifecycle as of this column's day (that happens on a later, already-scheduled day), so
  // it isn't "done" the way terminalGhostTitle's cell is.
  const pendingGhostTitle = ghost?.pendingTerminalStatus
    ? "This cell's next use is already scheduled for a later day - not available for a new placement here, but it hasn't reached the end of its own lifecycle yet."
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
          <div className={styles.ghostLabel} title={terminalGhostTitle ?? pendingGhostTitle}>
            {ghost.terminalStatus
              ? CELL_STATUS_LABEL[ghost.terminalStatus]
              : ghost.pendingTerminalStatus
                ? "Scheduled"
                : ghost.unused
                  ? "Not yet used"
                  : ghost.isHardCutoff
                    ? `Use ${ghost.useNumber} · expires today`
                    : `Use ${ghost.useNumber} · by ${formatShortDateUTC(parseDateOnly(ghost.cutoffDate))}`}
          </div>
        </>
      ) : blocked ? (
        <span
          className={styles.blockedIcon}
          title="This well is blocked - its cell was stopped and can't be reused here"
          aria-hidden="true"
        >
          ✕
        </span>
      ) : (
        <span className={styles.placeholder}>{placing ? "placing…" : dragging ? "" : "+"}</span>
      )}
      {showStage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
  }),
);

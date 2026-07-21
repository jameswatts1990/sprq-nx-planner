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

  // Before this ghost's own physical tray has had its first real placement, it renders
  // exactly like an ordinary empty "+" slot below - no "Scheduled"/"Not yet used" label or
  // tint, since the schedule isn't locked in yet and showing that this early reads as if
  // the tray were already physically present (see CellGhost.beforeTrayFounding). The real
  // `ghost` prop still flows through untouched to SchedulerSlot's droppable wiring, so
  // dropping here still targets this exact cell for reuse - only this component's own
  // rendering treats it as if there were no ghost at all.
  const renderGhost = ghost?.beforeTrayFounding ? undefined : ghost;

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
  const useClass = classForUseIndex(showStage ? stage!.use_number : renderGhost ? renderGhost.useNumber : slotIndex + 1);
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
  } else if (renderGhost) {
    classes.push(styles.ghost);
    if (renderGhost.terminalStatus) {
      // Neutral/severity-coded by *why* it went terminal, never tinted by use number -
      // this cell is done, so it must never read as a live Use 1/2/3 chip.
      classes.push(styles.ghostTerminal, TERMINAL_STATUS_CLASS[renderGhost.terminalStatus]);
    } else if (renderGhost.pendingTerminalStatus || renderGhost.pendingReuseStatus) {
      // Already fully booked (every remaining use scheduled) but not yet actually at that
      // state as of this column's day, or still open with spare capacity but already
      // claimed by its own not-yet-run next use - either way, a calmer, informational look,
      // distinct from both the red terminal severity above and the actionable Use-N tint
      // below, since this well is neither dead nor a live drop target.
      classes.push(styles.ghostPending);
    } else if (renderGhost.unused) {
      // Muted grey, not tinted by use number - it hasn't been used yet, so colouring it
      // like a real Use 1 (which .u1.ghost's higher-specificity two-class selector would
      // otherwise win over this single class regardless of declaration order) reads as
      // "this is already Use 1" and clashes with the real Use 1 tint elsewhere on the grid.
      classes.push(styles.ghostUnused);
    } else {
      classes.push(styles[useClass]);
      if (renderGhost.isHardCutoff) classes.push(styles.ghostCutoff);
    }
  } else if (blocked) {
    classes.push(styles.blocked);
  } else {
    classes.push(styles.empty);
  }
  if (locked) classes.push(styles.locked);
  if (placing) classes.push(styles.placing);
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
    } else if (renderGhost?.pendingReuseStatus) {
      // Hovering a "Scheduled" ghost previews inserting a new, earlier use of this cell -
      // distinct from an exact-match reuse of an already-eligible ghost (.ghostOver).
      classes.push(styles.ghostInsertOver);
    } else {
      // Hovering directly over a ghost previews an exact-match reuse of that specific
      // cell - a distinct highlight from the generic "valid drop target" look, which is
      // reserved for drops that still need the cell-choice popup (e.g. the plain "+"
      // placeholder).
      classes.push(renderGhost ? styles.ghostOver : styles.over);
    }
  }
  if (dragging) classes.push(styles.dragging);
  if (selected) classes.push(styles.selected);
  if (linkSource) classes.push(styles.linkSource);
  else if (linked) classes.push(styles.linkPeer);
  if (dimmed) classes.push(styles.dimmed);
  if (className) classes.push(className);

  // Fade intensity only applies to the calm (non-cutoff) ghost look - the cutoff variant
  // is a fixed, fully-opaque "act now" style regardless of how the fade would otherwise sit.
  let mergedStyle: CSSProperties | undefined =
    renderGhost && !renderGhost.isHardCutoff ? { ...style, ["--ghost-opacity" as string]: renderGhost.fadeOpacity } : style;
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

  // pendingTerminalStatus: every remaining use of this cell is already scheduled, so this
  // well can't take a new placement at all - but it hasn't actually reached the end of its
  // own lifecycle as of this column's day (that happens on a later, already-scheduled day).
  // pendingReuseStatus: this cell still has real spare capacity - dropping a sample here
  // inserts an earlier use, moving its already-planned later use to a higher Use N (never
  // removing it), as long as that later use hasn't actually started in the lab yet.
  const pendingGhostTitle = renderGhost?.pendingTerminalStatus
    ? "This cell's next use is already scheduled for a later day - not available for a new placement here, but it hasn't reached the end of its own lifecycle yet."
    : renderGhost?.pendingReuseStatus
      ? "This cell's next use is already scheduled for a later day. Drop a sample here to schedule an earlier use instead - the later use moves to the next Use number, unless it's already been confirmed loaded."
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
      ) : renderGhost ? (
        <>
          <div className={styles.ghostCode} title={renderGhost.cell.code}>
            {renderGhost.cell.code}
          </div>
          <div className={styles.ghostLabel} title={terminalGhostTitle ?? pendingGhostTitle}>
            {renderGhost.terminalStatus
              ? CELL_STATUS_LABEL[renderGhost.terminalStatus]
              : renderGhost.pendingTerminalStatus || renderGhost.pendingReuseStatus
                ? "Scheduled"
                : renderGhost.unused
                  ? "Not yet used"
                  : renderGhost.isHardCutoff
                    ? `Use ${renderGhost.useNumber} · expires today`
                    : `Use ${renderGhost.useNumber} · by ${formatShortDateUTC(parseDateOnly(renderGhost.cutoffDate))}`}
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

import { forwardRef, memo } from "react";
import type { CSSProperties, HTMLAttributes, MouseEvent } from "react";

import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { DuplicateBadge } from "@/components/shared/DuplicateBadge";
import { InsertSizeFlag } from "@/components/shared/InsertSizeFlag";
import { MovieTimeFlag } from "@/components/shared/MovieTimeFlag";
import { useInsertSizeThreshold } from "@/hooks/useInsertSizeThreshold";
import type { SlotIndex, StageOut } from "@/types/schedule";
import { classForCell, classForUseIndex, type UseClass } from "@/utils/useIndexClass";
import { cellPositionLabel, plateWellFromSlot } from "@/utils/plateWell";
import { CELL_LIFETIME_H, expiryFadeOpacity } from "@/utils/windowFade";

import styles from "./SchedulerSlotView.module.css";
import { CELL_LINK_SLOT_ATTR } from "./useCellLinkHighlight";

/** The ticket stub's solid base colour, per use colour class. */
const STUB_CLASS: Record<UseClass, string> = {
  u1: styles.stubU1,
  u2: styles.stubU2,
  u3: styles.stubU3,
  sprq: styles.stubSprq,
};

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
  /** A backlog sample is being dragged over this already-occupied slot - nothing to swap
   * with, so this is a rejected target rather than a valid drop preview (see `over`).
   * Ignored when `over` is set (only one drag kind can be active at a time). */
  overInvalid?: boolean;
  /** This filled slot is the active drag source - rendered as if unplaced (dashed
   * placeholder), matching what dropping it outside the grid would actually do (unless also
   * `over` - see above). */
  dragging?: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. */
  selected?: boolean;
  /** This is the exact slot currently hovered/pinned for the cross-time same-cell link
   * highlight (see useCellLinkHighlight.tsx). */
  linkSource?: boolean;
  /** A different slot sharing the same cell_id as the active hover/pin target. */
  linked?: boolean;
  /** A hover/pin target is active and this slot is neither the source nor a peer. */
  dimmed?: boolean;
  /** This filled slot is the one grid placement the Schedule page's unified search is
   * currently focused on (see searchHighlight.ts) - given a pulsing ring and marked
   * data-search-match so the page can scroll it into view when the search cycles here. */
  searchMatch?: boolean;
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
/** Max degrees of tilt in either axis - enough to read as a lively 3D wiggle as the cursor
 * moves across the card, without swinging so far it distorts the label. */
const MAX_TILT_DEG = 12;

/** Sets the card's --tilt-x/--tilt-y custom properties directly on the DOM node (bypassing
 * React state) so a grid of hundreds of slots doesn't re-render on every mousemove pixel -
 * only the one card under the cursor ever does any work. Position is clamped to the card's
 * own box so a stray mousemove just outside its rounded corners can't drive the tilt to an
 * exaggerated angle. */
function applySlotTilt(e: MouseEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  el.style.setProperty("--tilt-x", `${((0.5 - py) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
  el.style.setProperty("--tilt-y", `${((px - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
}

function resetSlotTilt(e: MouseEvent<HTMLDivElement>) {
  e.currentTarget.style.setProperty("--tilt-x", "0deg");
  e.currentTarget.style.setProperty("--tilt-y", "0deg");
}

/** Pool IDs share a long prefix ("TRAC-2-") and differ in the trailing digits, so a card too
 * narrow for the whole ID wraps it after the last hyphen ("TRAC-2-" / "28339") rather than
 * truncating away the part that tells samples apart. A "-2" never breaks on its own (Unicode
 * treats it as a negative number), hence the explicit <wbr>. */
function breakablePoolId(id: string) {
  const cut = id.lastIndexOf("-") + 1;
  if (cut <= 1 || cut >= id.length) return id;
  return (
    <>
      {id.slice(0, cut)}
      <wbr />
      {id.slice(cut)}
    </>
  );
}

export const SchedulerSlotView = memo(
  forwardRef<HTMLDivElement, SchedulerSlotViewProps>(function SchedulerSlotView(
    {
      stage,
      slotIndex,
      locked,
      placing,
      over,
      overInvalid,
      dragging,
      selected,
      linkSource,
      linked,
      dimmed,
      searchMatch,
      onOpenCell,
      className,
      style,
      onMouseMove,
      onMouseLeave,
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

  // This placement's cell already burned this exact barcode with a DIFFERENT sample (see
  // cell_service.has_barcode_clash) - either because ordinary placement kept it here to
  // preserve the tray's loading order (a manual drop never reroutes to dodge a clash - see
  // placement_service._reuse_eligible), or a Cell QC re-zip landed it there. Either way two
  // samples on the instrument can no longer be told apart by barcode, a data-integrity risk
  // that outranks every qcAlert severity above, so it wins the card's single alert slot
  // outright rather than being folded into that ladder (see classes/label below).
  const barcodeClash = showStage && !!stage!.barcode_clash;

  // Small-insert (<= admin threshold) libraries lose yield when a cell is re-used (see
  // InsertSizeFlag) - flagged here too (not just the small text badge) so the risk reads at a
  // glance across a full week without hunting for the badge text. The top-stripe warning is
  // reserved for the case PacBio actually flags (a small insert sitting on a cell's 2nd/3rd
  // use, use_number >= 2); a small insert on its first use is fine and gets only the orange
  // InsertSizeFlag badge, no stripe.
  const insertThreshold = useInsertSizeThreshold();
  const insertSizeAlert = showStage && stage!.insert_size_bp != null && stage!.insert_size_bp <= insertThreshold;
  const insertSizeReuseRisk = insertSizeAlert && stage!.use_number >= 2;

  // This reuse (Use 2/3) has slipped past its cell's 108h reuse deadline - it can no longer
  // physically start in time (see StageOut.reuse_window_exceeded). Only flagged while the use is
  // still "planned" (the actionable case - typically a run that failed to load and was pushed to
  // a later day): a use that already ran or carries a QC outcome doesn't need this. Additive, like
  // the insert-size stripe - it coexists with, never replaces, a clash/QC alert on the same card,
  // and the slot/cell popover offers the one-click "Load fresh tray" fix.
  const windowExceeded = showStage && !!stage!.reuse_window_exceeded && stage!.cell_use_status === "planned";

  // Colour groups by which physical cell is loaded (stage.use_number), not by well
  // position - so a cell reused across two wells in the same run shares one colour. A
  // single-use SPRQ cell reads in its own SPRQ colour instead.
  const useClass = showStage ? classForCell(stage!.use_number, stage!.cell_type) : classForUseIndex(slotIndex + 1);
  const isSprq = showStage && stage!.cell_type === "sprq";
  // The right-edge cell "ticket stub": the physical CELL's position (PacBio "cell 1-4" -
  // NUMBERED, since plates are lettered) plus the use number in its own colour-coded square,
  // e.g. "▣1 [1]" = cell 1, Use 1. The position prefix is U+25A3 (▣), not the letter "C", so it
  // never gets misread as a plate well's column-C. Only rendered on a filled card with an
  // onOpenCell handler.
  const showStub = showStage && !!onOpenCell;
  // The stub names the physical CELL, not the loading slot: its tray position (1-4, falling
  // back to the home-well letter A-D -> 1-4 for a legacy tray-less cell), so a sample loaded
  // in slot A01 but running on cell 2 reads "▣2".
  const stubCell = showStage ? cellPositionLabel(stage!.tray_position, stage!.cell_home_well ?? stage!.well) : "";
  const stubUse = showStage ? stage!.use_number : 0;
  const stubClass = showStage ? STUB_CLASS[useClass] : "";
  // Holographic "security seal" identity: every physical cell gets its own look, so the same
  // cell+use label (e.g. "▣1 [1]") on two different days reads as two DIFFERENT physical cells
  // at a glance. Two independent, deterministic signals both keyed off the cell:
  //   - a per-cell hue rotation of the iridescent sheen (golden-angle spread so adjacent cell
  //     ids land far apart on the wheel), and
  //   - the cell's tray id printed as microtext along the bottom of the seal (like the
  //     micro-lettering on a real holographic security sticker) - so cells from the same tray
  //     share a family number while the per-cell hue still keeps them individually distinct.
  // The Use 1/2/3 base colour is untouched underneath, so the use number still reads normally.
  const sealNum = showStage
    ? (stage!.tray_id != null
        ? String(stage!.tray_id)
        : (stage!.cell_ref?.match(/(\d+)\s*$/)?.[1]?.replace(/^0+/, "") ?? "") || String(stage!.cell_id))
    : "";
  const sealHue = showStage ? Math.round((stage!.cell_id * 137.508) % 360) : 0;
  const classes = [styles.slot];
  if (showStage) {
    classes.push(styles.filled, styles[useClass]);
    // Severity scale, lightest to most severe: Aborted (run/instrument problem, not a
    // cell-quality one) gets the mildest amber/yellow "warning" treatment; Failed (a real
    // cell-quality concern, but this one physical cell may still be fine otherwise) gets
    // its own distinct orange, between warning and danger; Stopped and Cancelled/"Blocked"
    // (a future use lost because the whole cell was taken out of service) share the same
    // red "danger" severity, since both mean this physical cell is permanently done.
    if (barcodeClash) classes.push(styles.barcodeClash);
    else if (qcAlert === "cancelled") classes.push(styles.qcAlertCancelled);
    else if (qcAlert === "aborted") classes.push(styles.qcAlertWarn);
    else if (qcAlert === "failed") classes.push(styles.qcAlertFailed);
    else if (qcAlert) classes.push(styles.qcAlert);
    // Additive, not part of the ladder above - a top-edge stripe rather than a border colour,
    // so it never fights with a QC/clash alert also carried by the same card. Only shown on a
    // small-insert reuse (use_number >= 2); a first use carries just the InsertSizeFlag badge.
    if (insertSizeReuseRisk) classes.push(styles.insertFlag, styles.insertFlagRisk);
    // Additive top-edge stripe (its own colour, distinct from the insert-size one) for a reuse
    // that has slipped past its 108h window - never a border colour, so it can sit alongside a
    // clash/QC alert on the same card.
    if (windowExceeded) classes.push(styles.windowFlag, styles.windowFlagExceeded);
    // Shades toward the same fade as a waiting-cell ghost, but driven by this cell's own
    // elapsed time rather than time-to-deadline - "denote the passing of time until a
    // [cell's] expiry" (see docs/pacbio-sprq-nx-scheduling-reference.md #2: this is always
    // per-cell, never a shared tray-level clock).
    if (stage!.window_hours_elapsed !== null) classes.push(styles.windowShaded);
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
  } else if (overInvalid) {
    // A backlog sample hovering an already-occupied slot - nothing to swap with, so this
    // reads as a rejected target instead of silently giving no feedback at all (see
    // useSchedulerDnd's onDragEnd, which now also surfaces a message on drop).
    classes.push(styles.overInvalid);
  }
  if (dragging) classes.push(styles.dragging);
  if (searchMatch) classes.push(styles.searchMatch);
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

  // The mouse-follow tilt is only for actual placed cards, not the empty "+"/locked
  // grid structure - composed with (not replacing) any onMouseMove/onMouseLeave the caller
  // already wired up (e.g. DraggableSlot/ClickableSlot's cross-time cell-link hover).
  const handleMouseMove = showStage
    ? (e: MouseEvent<HTMLDivElement>) => {
        applySlotTilt(e);
        onMouseMove?.(e);
      }
    : onMouseMove;
  const handleMouseLeave = showStage
    ? (e: MouseEvent<HTMLDivElement>) => {
        resetSlotTilt(e);
        onMouseLeave?.(e);
      }
    : onMouseLeave;

  return (
    <div
      ref={ref}
      className={classes.join(" ")}
      style={mergedStyle}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...(showStage ? { [CELL_LINK_SLOT_ATTR]: "" } : {})}
      {...(searchMatch ? { "data-search-match": "true" } : {})}
      {...rest}
    >
      {showStage ? (
        <>
          {/* Big, faint use-number watermark behind the card content (1/2/3 = which use of this
              physical cell this placement is), tinted by the same Use 1/2/3 colour. Opt-in
              (default off) - the grid area's data-use-number attribute reveals it; rendered here
              (always, when filled) so the toggle is pure CSS. Sits on a negative z-index so it
              reads as a watermark under the text, never over it. */}
          <span
            className={`${styles.useNumberWatermark} ${styles[useClass]}`}
            data-use-watermark
            aria-hidden="true"
          >
            {stage!.use_number}
          </span>
          <div className={styles.ext} title={stage!.sample_pool_id ?? stage!.cell_ref}>
            {stage!.sample_pool_id ? breakablePoolId(stage!.sample_pool_id) : "—"}
          </div>
          <div className={styles.cellref}>
            {stage!.cell_ref}
            <DuplicateBadge
              index={stage!.duplicate_index}
              total={stage!.duplicate_total}
              selfReuse={stage!.duplicate_cell_reuse}
              compact
            />
            {stage!.notes && (
              <span
                className={styles.noteFlag}
                data-note-indicator
                title={stage!.notes}
                aria-label={`Note: ${stage!.notes}`}
              >
                {/* A note page (folded corner, two text lines) - not ✎, which means Edit. */}
                <svg
                  width="1em"
                  height="1em"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 1.5h5l2.5 2.5v6.5h-7.5z" />
                  <path d="M7.5 1.5v2.5h2.5" />
                  <path d="M4.25 6.5h3.5M4.25 8.5h2.5" />
                </svg>
              </span>
            )}
            <InsertSizeFlag sizeBp={stage!.insert_size_bp} compact />
            {/* This well's own run time (per-cell, editable in the slot popover), not the sample's. */}
            <MovieTimeFlag hours={stage!.run_time_hours} compact />
          </div>
          {barcodeClash ? (
            <div
              className={styles.qcAlertLabelClash}
              title="Barcode clash - this cell already burned this exact barcode with a DIFFERENT sample (either kept here to preserve the tray's loading order, or landed here by a Cell QC re-zip). The two can no longer be reliably told apart in the sequencing output - check this cell on the Cells page before this run proceeds."
            >
              ⚠ Clash
            </div>
          ) : (
            qcAlert && (
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
            )
          )}
          {windowExceeded && (
            <div
              className={styles.windowExceededLabel}
              title="Out of window - this cell's 108h reuse deadline has passed for this day, so this Use can no longer start in time. Open the slot for details, then load a fresh tray for it."
            >
              ⚠ Window
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
              title={
                isSprq
                  ? `Cell ${stage!.cell_ref} · single-use SPRQ cell — click for cell details`
                  : `Cell ${stage!.cell_ref} · Use ${stage!.use_number} of ${stage!.cell_max_uses} — click for cell details`
              }
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
                {sealNum}
              </span>
              <span className={styles.stubLabel}>
                <span className={styles.stubCell}>
                  <span className={styles.stubCellGlyph}>{stubCell.slice(0, 1)}</span>
                  {stubCell.slice(1)}
                </span>
                <span className={styles.stubUseBox}>{stubUse}</span>
              </span>
            </button>
          )}
        </>
      ) : (
        <span
          className={styles.placeholder}
          title={locked && !placing ? "This run is locked - it can't accept new placements or moves." : undefined}
        >
          {placing ? "placing…" : dragging ? (over ? "stays here" : "") : `+ ${plateWellFromSlot(slotIndex)}`}
        </span>
      )}
      {showStage && placing && <div className={styles.shimmer}>placing…</div>}
    </div>
  );
  }),
);

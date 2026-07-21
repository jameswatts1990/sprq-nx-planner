import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { useContext } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import type { SlotIndex, StageOut } from "@/types/schedule";

import { deriveLinkState } from "./cellLinkState";
import { slotKey } from "./gridKeys";
import { SchedulerSlotView } from "./SchedulerSlotView";
import { CellLinkContext } from "./useCellLinkHighlight";
import type { FilledSlotDragData, OccupiedSlotDropData, SlotDropData } from "./useSchedulerDnd";
import type { CellGhost } from "./waitingCells";

export interface SchedulerSlotProps {
  stage: StageOut | null;
  slotIndex: SlotIndex;
  instrumentSerial: string;
  runDate: string;
  /** The owning cycle is confirmed/locked (status !== "planned"). */
  locked: boolean;
  /** This slot has an in-flight place/remove mutation. */
  placing: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. Always false when locked. */
  selected: boolean;
  onOpenDetail: (stage: StageOut) => void;
  /** Ctrl/cmd-click on a filled, unlocked slot toggles selection instead of opening detail. */
  onToggleSelect: (stage: StageOut) => void;
  /** Ctrl/cmd+shift-click extends the selection to every eligible slot between the last
   * toggled slot and this one (see useSlotSelection's anchor / SchedulePage's
   * onExtendSlotSelect). */
  onExtendSelect: (stage: StageOut) => void;
  /** A waiting, reusable cell eligible to load into this empty slot today. */
  ghost?: CellGhost;
  /** Opens the waiting-cell detail/discard popover; only meaningful when `ghost` is set. */
  onOpenGhost?: (ghost: CellGhost) => void;
  /** This well is permanently blocked by a stopped cell (see waitingCells.
   * groupBlockedWellsByInstrument) - read-only, never a drop target. */
  blocked?: boolean;
}

/**
 * Interactive slot: droppable when empty+unlocked, draggable AND droppable when
 * filled+unlocked (dropping a placed sample there either no-ops onto itself or swaps with
 * whatever's there - see useSchedulerDnd's onDragEnd), click-to-open-detail when filled.
 * dnd-kit hooks can't be called conditionally, so the empty/filled branches are separate
 * leaf components (React swaps them on transition).
 */
export function SchedulerSlot(props: SchedulerSlotProps) {
  const { stage, locked, blocked } = props;

  if (!stage) {
    // A stopped cell's well is a permanent, read-only marker - never droppable, and
    // blocked regardless of the day's own lock state (see waitingCells.
    // groupBlockedWellsByInstrument / cell_service.stop_cell).
    if (blocked) {
      return <SchedulerSlotView stage={null} slotIndex={props.slotIndex} blocked />;
    }
    if (locked) {
      // Only an unused-tray-sibling, terminal, or pending-terminal ghost ever reaches here
      // (SchedulerDayCell excludes reuse ghosts once locked), so it's purely informational -
      // no droppable wrapper.
      return (
        <SchedulerSlotView
          stage={null}
          slotIndex={props.slotIndex}
          locked
          placing={props.placing}
          ghost={props.ghost}
        />
      );
    }
    // A terminal ghost's well (exhausted/window_expired/retired - see waitingCells.
    // computeTerminalGhost) only exists at all while some sibling in that same physical
    // tray still holds real capacity - computeTerminalGhost itself stops returning one the
    // moment every sibling has also gone terminal (waitingCells.computeVacatedTrayIds), so
    // reaching this branch always means the tray hasn't actually left the instrument yet,
    // and this well must stay a read-only marker, same non-droppable treatment as a
    // `blocked` well above, never registered with dnd-kit at all. A pending-terminal ghost
    // (waitingCells.computePendingTerminalGhost) is never droppable either, unconditionally
    // - every one of its remaining uses is already scheduled, so there's no spare capacity
    // left to insert into (would blow the 3-use cap). A pending-reuse ghost
    // (waitingCells.computeGhost's pendingReuseStatus branch) IS droppable, below: the cell
    // still has real spare capacity, just already claimed on this well by its own
    // not-yet-run next use - dropping a sample here inserts an earlier use, moving that
    // later use to a higher Use N (see _resolve_cell_choice's chronological-order guard,
    // which rejects this once the later use has actually started).
    if (props.ghost?.terminalStatus || props.ghost?.pendingTerminalStatus) {
      return <SchedulerSlotView stage={null} slotIndex={props.slotIndex} ghost={props.ghost} />;
    }
    return <DroppableSlot {...props} />;
  }

  // A cancelled stage (cell was stopped before this use could run) is a permanent,
  // read-only marker - its sample already bounced back to the backlog, so there's
  // nothing left here to drag or reassign.
  const canDrag = !locked && stage.sample_id !== null && stage.cell_use_status !== "cancelled";
  if (canDrag) {
    return <DraggableSlot {...props} stage={stage} />;
  }
  // Locked, or filled without a movable sample: view + open-detail only.
  return <ClickableSlot {...props} stage={stage} />;
}

function DroppableSlot({
  slotIndex,
  instrumentSerial,
  runDate,
  placing,
  ghost,
  onOpenGhost,
}: SchedulerSlotProps) {
  // A terminal ghost (exhausted/window_expired/retired) never reaches this droppable
  // branch: computeTerminalGhost stops returning one at all once its whole physical tray
  // has been vacated, and SchedulerSlot already filters out the still-loaded case above -
  // so `ghost` here is always either undefined or a still-open, reuse-eligible/unused-
  // sibling ghost, safe to treat as an exact-match reuse target.
  const reuseGhost = ghost;
  const data: SlotDropData = {
    kind: "slot",
    instrument_serial: instrumentSerial,
    run_date: runDate,
    slot_index: slotIndex,
    ghostCellId: reuseGhost?.cell.id,
  };
  const { setNodeRef, isOver } = useDroppable({
    id: slotKey(instrumentSerial, runDate, slotIndex),
    data,
  });
  return (
    <SchedulerSlotView
      ref={setNodeRef}
      stage={null}
      slotIndex={slotIndex}
      over={isOver}
      placing={placing}
      ghost={ghost}
      onClick={reuseGhost && onOpenGhost ? () => onOpenGhost(reuseGhost) : undefined}
    />
  );
}

function DraggableSlot({
  stage,
  slotIndex,
  instrumentSerial,
  runDate,
  placing,
  selected,
  onOpenDetail,
  onToggleSelect,
  onExtendSelect,
}: SchedulerSlotProps & { stage: StageOut }) {
  const data: FilledSlotDragData = {
    kind: "filledSlot",
    sample: {
      id: stage.sample_id as number,
      external_id: stage.sample_external_id ?? "",
      barcodes: stage.barcodes,
    },
    cell_use_id: stage.cell_use_id,
    cell_id: stage.cell_id,
    instrument_serial: instrumentSerial,
    run_date: runDate,
    slot_index: slotIndex,
  };
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } = useDraggable({
    id: slotKey(instrumentSerial, runDate, slotIndex),
    data,
  });
  // Also droppable, so dropping a dragged sample back onto this exact slot (a no-op) or
  // onto a different occupied slot (a swap) can be distinguished from "dropped outside
  // any valid target" (which today evicts the dragged sample to the backlog).
  const dropData: OccupiedSlotDropData = { kind: "occupiedSlot", cell_use_id: stage.cell_use_id };
  const { setNodeRef: setDropRef, isOver: rawIsOver } = useDroppable({
    id: slotKey(instrumentSerial, runDate, slotIndex),
    data: dropData,
  });
  // A backlog sample dragged over an occupied slot is deliberately a no-op (nothing to
  // swap with - see useSchedulerDnd's onDragEnd), so it gets no hover preview at all;
  // only an already-placed sample's drag (which will either no-op onto itself or swap
  // onto a different slot) shows one.
  const { active } = useDndContext();
  const isOver = rawIsOver && (active?.data.current as { kind?: string } | undefined)?.kind === "filledSlot";
  function setNodeRef(node: HTMLDivElement | null) {
    setDragRef(node);
    setDropRef(node);
  }
  const link = useContext(CellLinkContext);
  const { isSource, isPeer, isDimmed } = deriveLinkState(link.active, stage);
  const linkTarget = { cellId: stage.cell_id, sourceUseId: stage.cell_use_id };

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      onExtendSelect(stage);
      return;
    }
    if (e.shiftKey) {
      link.togglePin(linkTarget);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      onToggleSelect(stage);
      return;
    }
    onOpenDetail(stage);
  }
  // Composed with dnd-kit's own onKeyDown (keyboard drag activation) rather than
  // replacing it - Shift+Enter is otherwise unused by the keyboard sensor.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      link.togglePin(linkTarget);
      return;
    }
    (listeners?.onKeyDown as ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined)?.(e);
  }
  return (
    <SchedulerSlotView
      ref={setNodeRef}
      stage={stage}
      slotIndex={slotIndex}
      placing={placing}
      dragging={isDragging}
      over={isOver}
      selected={selected}
      linked={isPeer}
      linkSource={isSource}
      dimmed={isDimmed}
      onClick={onClick}
      onMouseEnter={() => link.setHover(linkTarget)}
      onMouseLeave={link.clearHover}
      {...listeners}
      {...attributes}
      onKeyDown={onKeyDown}
    />
  );
}

function ClickableSlot({
  stage,
  slotIndex,
  locked,
  placing,
  selected,
  onOpenDetail,
  onToggleSelect,
  onExtendSelect,
}: SchedulerSlotProps & { stage: StageOut }) {
  const link = useContext(CellLinkContext);
  const { isSource, isPeer, isDimmed } = deriveLinkState(link.active, stage);
  const linkTarget = { cellId: stage.cell_id, sourceUseId: stage.cell_use_id };

  const selectable = !locked && stage.cell_use_status !== "cancelled";

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (selectable && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      onExtendSelect(stage);
      return;
    }
    if (e.shiftKey) {
      link.togglePin(linkTarget);
      return;
    }
    if (selectable && (e.ctrlKey || e.metaKey)) {
      onToggleSelect(stage);
      return;
    }
    onOpenDetail(stage);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      link.togglePin(linkTarget);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDetail(stage);
    }
  }
  return (
    <SchedulerSlotView
      stage={stage}
      slotIndex={slotIndex}
      locked={locked}
      placing={placing}
      selected={selected}
      linked={isPeer}
      linkSource={isSource}
      dimmed={isDimmed}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => link.setHover(linkTarget)}
      onMouseLeave={link.clearHover}
    />
  );
}

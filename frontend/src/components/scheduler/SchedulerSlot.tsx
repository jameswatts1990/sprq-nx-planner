import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { useContext } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

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
  loadDate: string;
  /** The owning run is confirmed/locked (status !== "planned"). */
  locked: boolean;
  /** This slot has an in-flight place/remove mutation. */
  placing: boolean;
  /** Selected via ctrl/cmd-click, for the bulk-delete affordance. Always false when locked. */
  selected: boolean;
  onOpenDetail: (stage: StageOut) => void;
  /** Opens the in-grid cell-info popover for a filled slot's physical cell - the card's
   * right-edge "ticket stub" click (distinct from the card-body onOpenDetail). */
  onOpenCell?: (stage: StageOut) => void;
  /** Ctrl/cmd-click on a filled, unlocked slot toggles selection instead of opening detail. */
  onToggleSelect: (stage: StageOut) => void;
  /** Ctrl/cmd+shift-click extends the selection to every eligible slot between the last
   * toggled slot and this one (see useSlotSelection's anchor / SchedulePage's
   * onExtendSlotSelect). */
  onExtendSelect: (stage: StageOut) => void;
  /** Ctrl/cmd-mousedown on a filled, unlocked slot starts a click-and-drag rectangle
   * selection instead of (dnd-kit) moving the sample - see SchedulePage's
   * onDragSelectStart. */
  onDragSelectStart: (stage: StageOut) => void;
  /** A spent-well marker (terminal cell still occupying its well) to render non-droppably;
   * or a reuse ghost whose only job now is to carry its resident cell's id to the drop (see
   * DroppableSlot / SchedulerSlotView - reuse offers are no longer drawn as cards). */
  ghost?: CellGhost;
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
      // A grid slot is a physical well; an un-loaded well shows nothing but its own "+" (or, on
      // a locked run, a plain locked placeholder). The only forward-looking marker still drawn is
      // a spent-well one (a terminal cell still physically occupying the well) - a reuse offer is
      // no longer surfaced as its own card, so only a terminal ghost is passed through to render.
      return (
        <SchedulerSlotView
          stage={null}
          slotIndex={props.slotIndex}
          locked
          placing={props.placing}
          ghost={props.ghost?.terminalStatus ? props.ghost : undefined}
        />
      );
    }
    // A terminal ghost's well (exhausted/window_expired/retired - see waitingCells.
    // computeTerminalGhost) only exists at all while some sibling in that same physical
    // tray still holds real capacity - computeTerminalGhost itself stops returning one the
    // moment every sibling has also gone terminal (waitingCells.computeVacatedTrayIds), so
    // reaching this branch always means the tray hasn't actually left the instrument yet,
    // and this well must stay a read-only marker, same non-droppable treatment as a
    // `blocked` well above, never registered with dnd-kit at all. Every other empty slot is
    // droppable: placement is now blocked only by the instrument lock (handled above), never
    // by a future use merely being scheduled here (the old "Scheduled" pending ghosts were
    // removed - such a well is just a plain "+" now, and the drop resolves through
    // derive_best_cell like any other).
    if (props.ghost?.terminalStatus) {
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
  loadDate,
  placing,
  ghost,
}: SchedulerSlotProps) {
  // A terminal ghost never reaches this droppable branch (SchedulerSlot renders it as a
  // non-droppable spent-well marker above), so `ghost` here is always undefined or a reuse
  // offer - a used cell resident in this well, ready for its next use. The well itself renders
  // as a plain droppable "+" (a slot is a physical well; we don't paint a reuse card in it any
  // more), but the resident cell's id still rides along as `ghostCellId` so a drop resolves
  // straight onto it (its sequential next use) rather than opening a fresh tray - the backend's
  // reuse-before-new default made visible only once a sample is actually loaded, via its seal.
  const data: SlotDropData = {
    kind: "slot",
    instrument_serial: instrumentSerial,
    load_date: loadDate,
    slot_index: slotIndex,
    ghostCellId: ghost?.cell.id,
  };
  const { setNodeRef, isOver } = useDroppable({
    id: slotKey(instrumentSerial, loadDate, slotIndex),
    data,
  });
  return <SchedulerSlotView ref={setNodeRef} stage={null} slotIndex={slotIndex} over={isOver} placing={placing} />;
}

function DraggableSlot({
  stage,
  slotIndex,
  instrumentSerial,
  loadDate,
  placing,
  selected,
  onOpenDetail,
  onOpenCell,
  onToggleSelect,
  onExtendSelect,
  onDragSelectStart,
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
    load_date: loadDate,
    slot_index: slotIndex,
  };
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } = useDraggable({
    id: slotKey(instrumentSerial, loadDate, slotIndex),
    data,
  });
  // Also droppable, so dropping a dragged sample back onto this exact slot (a no-op) or
  // onto a different occupied slot (a swap) can be distinguished from "dropped outside
  // any valid target" (which today evicts the dragged sample to the backlog).
  const dropData: OccupiedSlotDropData = { kind: "occupiedSlot", cell_use_id: stage.cell_use_id };
  const { setNodeRef: setDropRef, isOver: rawIsOver } = useDroppable({
    id: slotKey(instrumentSerial, loadDate, slotIndex),
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
  // Ctrl/cmd-mousedown opts this pointer interaction out of dnd-kit's own drag entirely
  // (never forwarded to `listeners.onPointerDown`, so its sensor never activates) and
  // starts a rectangle-select drag instead - a plain ctrl-click with no movement still
  // fires a normal click afterward, handled by onClick's toggle branch above.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onDragSelectStart(stage);
      return;
    }
    (listeners?.onPointerDown as ((e: PointerEvent<HTMLDivElement>) => void) | undefined)?.(e);
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
      onOpenCell={onOpenCell ? () => onOpenCell(stage) : undefined}
      onMouseEnter={() => link.setHover(linkTarget)}
      onMouseLeave={link.clearHover}
      {...listeners}
      {...attributes}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
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
  onOpenCell,
  onToggleSelect,
  onExtendSelect,
  onDragSelectStart,
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
  // No dnd-kit listeners here (this branch is never draggable), so there's no drag to opt
  // out of - just start the rectangle-select tracking directly.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (selectable && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onDragSelectStart(stage);
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
      onOpenCell={onOpenCell ? () => onOpenCell(stage) : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onMouseEnter={() => link.setHover(linkTarget)}
      onMouseLeave={link.clearHover}
    />
  );
}

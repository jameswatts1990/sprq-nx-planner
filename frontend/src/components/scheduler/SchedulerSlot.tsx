import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { useContext } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import type { SlotIndex, StageOut } from "@/types/schedule";

import { deriveLinkState } from "./cellLinkState";
import { slotKey } from "./gridKeys";
import { SchedulerSlotView } from "./SchedulerSlotView";
import { CellLinkContext } from "./useCellLinkHighlight";
import type { DragData, FilledSlotDragData, OccupiedSlotDropData, SlotDropData } from "./useSchedulerDnd";
import { ghostWouldClashWithSample, type CellGhost } from "./waitingCells";

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
  /** A manual drop was just rejected on this exact slot for a barcode clash - see
   * useScheduleActions' clashSlotKey and SchedulerSlotView's clashFlash. */
  clashFlash?: boolean;
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
      // A grid slot is a plate LOADING position, not a cell: an un-loaded slot on a locked run
      // is just a plain locked placeholder. Cell state (a spent/exhausted resident) never blocks
      // a slot any more - which physical cell a drop lands on is derived at drop time
      // (derive_best_cell), so there's nothing cell-shaped to paint here.
      return <SchedulerSlotView stage={null} slotIndex={props.slotIndex} locked placing={props.placing} />;
    }
    // Every empty, unlocked slot is a plain droppable "+": a slot is a loading position, so it
    // never carries cell state. A spent/exhausted/terminal resident cell no longer blocks it -
    // the drop resolves to the next-usable cell in that tray (reuse-before-new) via the backend
    // derive_best_cell, made visible only afterwards by the loaded card's stub. The only thing
    // that still blocks a slot is the instrument lock (handled above) or a stopped-cell well.
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
  clashFlash,
  ghost,
}: SchedulerSlotProps) {
  // A slot is a plate LOADING position, not a cell: a drop never targets a specific resident
  // cell. Which physical cell it lands on is derived server-side (reuse-before-new, the
  // next-usable cell in this tray - see derive_best_cell), made visible only afterwards by the
  // loaded card's stub. So no cell id is threaded onto the drop.
  const data: SlotDropData = {
    kind: "slot",
    instrument_serial: instrumentSerial,
    load_date: loadDate,
    slot_index: slotIndex,
  };
  const { setNodeRef, isOver } = useDroppable({
    id: slotKey(instrumentSerial, loadDate, slotIndex),
    data,
  });
  // A live drag's own sample, read directly from dnd-kit's shared context rather than threaded
  // down as a prop - `active` only changes at drag start/end, so every slot in the grid
  // subscribing to it costs two re-renders per drag, not one per pointer move. Combined with
  // this slot's own reuse ghost (already computed by SchedulerDayCell) to warn, the moment a
  // drag starts, about every well whose natural next cell would clash - not just the one
  // currently hovered (see ghostWouldClashWithSample).
  const { active } = useDndContext();
  const dragged = active?.data.current as DragData | undefined;
  const draggedSample = dragged?.kind === "sample" || dragged?.kind === "filledSlot" ? dragged.sample : undefined;
  const dragClashWarning = !!draggedSample && ghostWouldClashWithSample(ghost, draggedSample);
  return (
    <SchedulerSlotView
      ref={setNodeRef}
      stage={null}
      slotIndex={slotIndex}
      over={isOver}
      placing={placing}
      clashFlash={clashFlash}
      dragClashWarning={dragClashWarning}
    />
  );
}

function DraggableSlot({
  stage,
  slotIndex,
  instrumentSerial,
  loadDate,
  placing,
  clashFlash,
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
  const dropData: OccupiedSlotDropData = {
    kind: "occupiedSlot",
    cell_use_id: stage.cell_use_id,
    instrument_serial: instrumentSerial,
    load_date: loadDate,
    slot_index: slotIndex,
  };
  const { setNodeRef: setDropRef, isOver: rawIsOver } = useDroppable({
    id: slotKey(instrumentSerial, loadDate, slotIndex),
    data: dropData,
  });
  // A backlog sample dragged over an occupied slot has nothing to swap with (see
  // useSchedulerDnd's onDragEnd) - a distinct rejected-target cue, not the swap preview an
  // already-placed sample's drag gets (which will either no-op onto itself or swap onto a
  // different slot).
  const { active } = useDndContext();
  const activeKind = (active?.data.current as { kind?: string } | undefined)?.kind;
  const isOver = rawIsOver && activeKind === "filledSlot";
  const isOverInvalid = rawIsOver && activeKind === "sample";
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
      overInvalid={isOverInvalid}
      clashFlash={clashFlash}
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

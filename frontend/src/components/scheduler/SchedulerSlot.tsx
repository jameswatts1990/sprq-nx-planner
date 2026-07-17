import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useContext } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import type { SlotIndex, StageOut } from "@/types/schedule";

import { deriveLinkState } from "./cellLinkState";
import { slotKey } from "./gridKeys";
import { SchedulerSlotView } from "./SchedulerSlotView";
import { CellLinkContext } from "./useCellLinkHighlight";
import type { FilledSlotDragData, SlotDropData } from "./useSchedulerDnd";
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
  /** A filled-slot ("move") drag is in progress from a *different* instrument than this
   * slot's - cells cannot move between instruments, so this slot must reject the drop. */
  crossInstrumentDragActive?: boolean;
  /** A waiting, reusable cell eligible to load into this empty slot today. */
  ghost?: CellGhost;
  /** Opens the waiting-cell detail/discard popover; only meaningful when `ghost` is set. */
  onOpenGhost?: (ghost: CellGhost) => void;
  /** This well is permanently blocked by a stopped cell (see waitingCells.
   * groupBlockedWellsByInstrument) - read-only, never a drop target. */
  blocked?: boolean;
}

/**
 * Interactive slot: droppable when empty+unlocked, draggable when filled+unlocked,
 * click-to-open-detail when filled. dnd-kit hooks can't be called conditionally, so the
 * empty/filled branches are separate leaf components (React swaps them on transition).
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
    // computeTerminalGhost) only accepts a brand-new physical tray once every sibling in
    // that same physical tray has also gone terminal (ghost.terminalTrayVacated) - while
    // any sibling still holds real capacity, the tray hasn't actually left the instrument,
    // so this well must stay a read-only marker, same non-droppable treatment as a
    // `blocked` well above, never registered with dnd-kit at all. A pending-terminal ghost
    // (waitingCells.computePendingTerminalGhost) is never droppable either, unconditionally
    // - its cell still has a real future use already scheduled on this exact well, so the
    // physical tray can't have left the instrument regardless of what terminalTrayVacated
    // would say (that field isn't even set on this ghost variant).
    if ((props.ghost?.terminalStatus && !props.ghost.terminalTrayVacated) || props.ghost?.pendingTerminalStatus) {
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
  crossInstrumentDragActive,
  ghost,
  onOpenGhost,
}: SchedulerSlotProps) {
  // A terminal ghost (exhausted/window_expired/retired - see waitingCells.
  // computeTerminalGhost) only ever reaches this droppable branch once its whole physical
  // tray has been vacated (SchedulerSlot already filters out the still-loaded case above),
  // so a drop here always resolves as an ordinary new-tray placement, never an attempted
  // reuse of that dead cell (which the backend would reject with "cell is not open"). Only
  // a still-open ghost (reuse-eligible or an unused sibling) is a real exact-match reuse
  // target.
  const reuseGhost = ghost && !ghost.terminalStatus ? ghost : undefined;
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
    disabled: crossInstrumentDragActive,
  });
  return (
    <SchedulerSlotView
      ref={setNodeRef}
      stage={null}
      slotIndex={slotIndex}
      over={isOver}
      placing={placing}
      ineligible={crossInstrumentDragActive}
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
}: SchedulerSlotProps & { stage: StageOut }) {
  const data: FilledSlotDragData = {
    kind: "filledSlot",
    sample: {
      id: stage.sample_id as number,
      external_id: stage.sample_external_id ?? "",
      barcodes: stage.barcodes,
    },
    cell_use_id: stage.cell_use_id,
    instrument_serial: instrumentSerial,
    run_date: runDate,
    slot_index: slotIndex,
  };
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: slotKey(instrumentSerial, runDate, slotIndex),
    data,
  });
  const link = useContext(CellLinkContext);
  const { isSource, isPeer, isDimmed } = deriveLinkState(link.active, stage);
  const linkTarget = { cellId: stage.cell_id, sourceUseId: stage.cell_use_id };

  function onClick(e: MouseEvent<HTMLDivElement>) {
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
}: SchedulerSlotProps & { stage: StageOut }) {
  const link = useContext(CellLinkContext);
  const { isSource, isPeer, isDimmed } = deriveLinkState(link.active, stage);
  const linkTarget = { cellId: stage.cell_id, sourceUseId: stage.cell_use_id };

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (e.shiftKey) {
      link.togglePin(linkTarget);
      return;
    }
    if (!locked && stage.cell_use_status !== "cancelled" && (e.ctrlKey || e.metaKey)) {
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

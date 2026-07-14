import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { KeyboardEvent, MouseEvent } from "react";

import type { SlotIndex, StageOut } from "@/types/schedule";

import { slotKey } from "./gridKeys";
import { SchedulerSlotView } from "./SchedulerSlotView";
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
}

/**
 * Interactive slot: droppable when empty+unlocked, draggable when filled+unlocked,
 * click-to-open-detail when filled. dnd-kit hooks can't be called conditionally, so the
 * empty/filled branches are separate leaf components (React swaps them on transition).
 */
export function SchedulerSlot(props: SchedulerSlotProps) {
  const { stage, locked } = props;

  if (!stage) {
    if (locked) {
      return <SchedulerSlotView stage={null} slotIndex={props.slotIndex} locked placing={props.placing} />;
    }
    return <DroppableSlot {...props} />;
  }

  const canDrag = !locked && stage.sample_id !== null;
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
  const data: SlotDropData = {
    kind: "slot",
    instrument_serial: instrumentSerial,
    run_date: runDate,
    slot_index: slotIndex,
    ghostCellId: ghost?.cell.id,
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
      onClick={ghost && onOpenGhost ? () => onOpenGhost(ghost) : undefined}
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
  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey) {
      onToggleSelect(stage);
      return;
    }
    onOpenDetail(stage);
  }
  return (
    <SchedulerSlotView
      ref={setNodeRef}
      stage={stage}
      slotIndex={slotIndex}
      placing={placing}
      dragging={isDragging}
      selected={selected}
      onClick={onClick}
      {...listeners}
      {...attributes}
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
  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (!locked && (e.ctrlKey || e.metaKey)) {
      onToggleSelect(stage);
      return;
    }
    onOpenDetail(stage);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
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
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    />
  );
}

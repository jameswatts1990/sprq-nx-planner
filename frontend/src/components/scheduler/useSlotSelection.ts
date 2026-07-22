import { useCallback, useMemo, useState } from "react";

import type { StageOut } from "@/types/schedule";

import type { Coord } from "./useGridSelection";

export interface SlotSelection {
  isSelected: (cellUseId: number) => boolean;
  selectedStages: StageOut[];
  /** Ctrl/cmd-click a filled, unlocked slot to toggle it in/out of the selection. */
  toggle: (stage: StageOut, coord: Coord) => void;
  /** Replace the whole selection outright (used for ctrl/cmd+shift-click rectangle
   * extension - see SchedulePage's onExtendSlotSelect). */
  replaceWith: (stages: StageOut[]) => void;
  clear: () => void;
  hasSelection: boolean;
  /** Grid coordinate of the last toggled slot, so a later ctrl/cmd+shift-click knows
   * where to extend a rectangle from. */
  anchor: Coord | null;
}

/**
 * Disjoint multi-select over placed samples (cell_use rows), keyed by cell_use_id, so
 * several can be removed from the schedule at once (e.g. via a Delete keypress). Kept
 * separate from useGridSelection (which selects empty day-cells for auto-fill) since the
 * two selections apply to different things and can be active independently.
 */
export function useSlotSelection(): SlotSelection {
  const [selected, setSelected] = useState<Map<number, StageOut>>(() => new Map());
  const [anchor, setAnchor] = useState<Coord | null>(null);

  const isSelected = useCallback((cellUseId: number) => selected.has(cellUseId), [selected]);

  const toggle = useCallback((stage: StageOut, coord: Coord) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(stage.cell_use_id)) next.delete(stage.cell_use_id);
      else next.set(stage.cell_use_id, stage);
      return next;
    });
    setAnchor(coord);
  }, []);

  const replaceWith = useCallback((stages: StageOut[]) => {
    setSelected(new Map(stages.map((stage) => [stage.cell_use_id, stage])));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Map());
    setAnchor(null);
  }, []);

  const selectedStages = useMemo(() => Array.from(selected.values()), [selected]);

  // Memoized so the object identity only changes when the selection/anchor changes - lets
  // the memoized grid rows/cells skip re-renders on unrelated page state changes.
  return useMemo(
    () => ({ isSelected, selectedStages, toggle, replaceWith, clear, hasSelection: selected.size > 0, anchor }),
    [isSelected, selectedStages, toggle, replaceWith, clear, selected.size, anchor],
  );
}

import { useCallback, useMemo, useState } from "react";

import type { StageOut } from "@/types/schedule";

export interface SlotSelection {
  isSelected: (cellUseId: number) => boolean;
  selectedStages: StageOut[];
  /** Ctrl/cmd-click a filled, unlocked slot to toggle it in/out of the selection. */
  toggle: (stage: StageOut) => void;
  clear: () => void;
  hasSelection: boolean;
}

/**
 * Disjoint multi-select over placed samples (cell_use rows), keyed by cell_use_id, so
 * several can be removed from the schedule at once (e.g. via a Delete keypress). Kept
 * separate from useGridSelection (which selects empty day-cells for auto-fill) since the
 * two selections apply to different things and can be active independently.
 */
export function useSlotSelection(): SlotSelection {
  const [selected, setSelected] = useState<Map<number, StageOut>>(() => new Map());

  const isSelected = useCallback((cellUseId: number) => selected.has(cellUseId), [selected]);

  const toggle = useCallback((stage: StageOut) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(stage.cell_use_id)) next.delete(stage.cell_use_id);
      else next.set(stage.cell_use_id, stage);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  const selectedStages = useMemo(() => Array.from(selected.values()), [selected]);

  return { isSelected, selectedStages, toggle, clear, hasSelection: selected.size > 0 };
}

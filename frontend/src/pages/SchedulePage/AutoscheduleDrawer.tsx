import { Drawer } from "@/components/ui/Drawer";
import type { CellOut } from "@/types/cell";

import { AutoscheduleReuseTrays } from "./AutoscheduleReuseTrays";
import { RunDesignFields, runDesignSummary } from "./RunDesignFields";
import type { RunDesignFieldsProps } from "./RunDesignFields";

export interface AutoscheduleDrawerProps extends RunDesignFieldsProps {
  onClose: () => void;
  /** Every open cell (SchedulePage's waiting-ghosts query), grouped into the reuse-candidate
   * tray list with its per-tray "Skip reuse" toggle. */
  reuseCandidateCells: CellOut[];
}

/** The Autoschedule side pop-out: the Run Design dials in a left-docked drawer, opened
 * from the Schedule page's ✨ Autoschedule button. Its Auto schedule / Clear actions act
 * on the grid selection behind the (deliberately light) scrim, so the selection stays
 * visible while the panel is open. */
export function AutoscheduleDrawer({ onClose, reuseCandidateCells, ...fields }: AutoscheduleDrawerProps) {
  return (
    <Drawer title="Autoschedule" subtitle={runDesignSummary(fields.runDesign)} onClose={onClose}>
      <RunDesignFields {...fields} reuseTraysSlot={<AutoscheduleReuseTrays cells={reuseCandidateCells} />} />
    </Drawer>
  );
}

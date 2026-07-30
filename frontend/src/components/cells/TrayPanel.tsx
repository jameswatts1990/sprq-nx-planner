import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellOut } from "@/types/cell";
import { soonestTrayExpiry } from "@/utils/openTrays";
import { FADE_MIN_HOURS } from "@/utils/windowFade";

import { CellStatusCard } from "./CellStatusCard";
import styles from "./TrayPanel.module.css";

export interface TrayPanelProps {
  trayId: number;
  cells: CellOut[];
  /** Highlights this cell's card (the cell you're viewing on a cell-detail page). */
  currentCellId?: number;
  /** Whether to offer the tray-wide "Discard all cells" action (default true). */
  showDiscard?: boolean;
}

function expiryText(hours: number): string {
  return hours <= 1 ? "<1h" : `${Math.ceil(hours)}h`;
}

/**
 * A physical tray's cells shown exactly as the main Cells grid shows them - a summary line
 * (instrument, cells n/size, soonest window expiry) over a grid of the same {@link CellStatusCard}s.
 * The single home for the tray-wide "Discard all cells" action, and the shared body behind both
 * the tray-filtered Cells page (`/cells?tray=…`) and the cell-detail page's "Cell tray" card - so
 * a tray reads identically wherever it appears, and the dedicated Tray page is no longer needed.
 */
export function TrayPanel({ trayId, cells, currentCellId, showDiscard = true }: TrayPanelProps) {
  const queryClient = useQueryClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const discardMutation = useMutation({
    mutationFn: () => cellsApi.discardTray({ tray_id: trayId }),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setConfirmDiscard(false);
    },
  });

  const traySize = cells[0]?.tray_size ?? cells.length;
  const instrument = cells.find((c) => c.current_instrument_serial)?.current_instrument_serial ?? null;
  const soonest = soonestTrayExpiry(cells);
  const urgent = soonest !== null && soonest <= FADE_MIN_HOURS;
  const anyOpen = cells.some((c) => c.status === "open");
  const reuseSkipped = cells.some((c) => c.tray_reuse_disabled);

  return (
    <div className={styles.panel}>
      <div className={styles.meta}>
        {instrument ? (
          <Link to={`/cells?instrument=${encodeURIComponent(instrument)}&status=all`} className={styles.metaItem}>
            {instrument}
          </Link>
        ) : (
          <span className={styles.metaItem}>No instrument</span>
        )}
        <span className={styles.metaSep}>·</span>
        <span className={styles.metaItem}>
          {cells.length}/{traySize} cells
        </span>
        {soonest !== null && (
          <Badge tone={urgent ? "danger" : "default"}>
            {urgent ? "Expires soon — " : "Next expiry: "}
            {expiryText(soonest)}
          </Badge>
        )}
        {reuseSkipped && <Badge tone="warning">Reuse skipped</Badge>}
      </div>

      <div className={styles.grid}>
        {cells.map((cell) => (
          <div
            key={cell.id}
            className={cell.id === currentCellId ? styles.current : undefined}
          >
            <CellStatusCard cell={cell} />
          </div>
        ))}
      </div>

      {showDiscard && anyOpen && (
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
            Discard all cells
          </Button>
        </div>
      )}

      {confirmDiscard && (
        <ConfirmModal
          title="Discard all cells in this tray?"
          confirmLabel="Discard cells"
          pendingLabel="Discarding…"
          pending={discardMutation.isPending}
          error={
            discardMutation.isError
              ? discardMutation.error instanceof ApiError
                ? discardMutation.error.message
                : "Failed to discard tray."
              : null
          }
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => discardMutation.mutate()}
        >
          <p>
            This marks every cell physically in this tray as exhausted, regardless of how many uses it has left. Any
            not-yet-run placements for these cells are cancelled and their samples return to the backlog. This cannot be
            undone.
          </p>
        </ConfirmModal>
      )}

      {discardMutation.isError && !confirmDiscard && (
        <Note tone="bad" icon="!">
          {discardMutation.error instanceof ApiError ? discardMutation.error.message : "Failed to discard tray."}
        </Note>
      )}
    </div>
  );
}

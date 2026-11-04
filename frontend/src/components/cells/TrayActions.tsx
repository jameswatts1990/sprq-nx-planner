import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellOut, TrayRestoreOut } from "@/types/cell";
import { discardedWithUsesLeft } from "@/utils/cellStatus";

import styles from "./TrayActions.module.css";

export interface TrayActionsProps {
  trayId: number;
  cells: CellOut[];
}

/**
 * The tray-wide actions, offered under an expanded tray on the Cells page:
 * - Skip reuse / Allow reuse - the reversible "planning a disposal" flag (also on Autoschedule's
 *   Reuse this week list): Autoschedule stops reusing the tray; no status changes.
 * - Discard all cells - force every cell exhausted and cancel their not-yet-run placements.
 * - Restore tray - un-discard, moving a rotate's later uses back where they can be.
 * A tray is one physical box, so there is deliberately no per-cell discard here.
 */
export function TrayActions({ trayId, cells }: TrayActionsProps) {
  const queryClient = useQueryClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  // Kept after a successful restore to surface any drift / bay conflict the modal can't (it
  // closes on success). Null when there's nothing noteworthy to report.
  const [restoreResult, setRestoreResult] = useState<TrayRestoreOut | null>(null);

  const anyOpen = cells.some((c) => c.status === "open");
  // Only worth restoring when the discard closed off uses - not Autoschedule's disposal of a
  // fully used tray.
  const anyDiscarded = cells.some(discardedWithUsesLeft);
  const reuseSkipped = cells.some((c) => c.tray_reuse_disabled);

  const skipReuse = useMutation({
    mutationFn: (disabled: boolean) => cellsApi.setTraySkipReuse({ tray_id: trayId, disabled }),
    onSuccess: () => invalidateScheduleRelated(queryClient),
  });

  const discardMutation = useMutation({
    mutationFn: () => cellsApi.discardTray({ tray_id: trayId }),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      setConfirmDiscard(false);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => cellsApi.restoreTray({ tray_id: trayId }),
    onSuccess: (res) => {
      invalidateScheduleRelated(queryClient);
      setConfirmRestore(false);
      setRestoreResult(res.drifted_use_ids.length > 0 || res.bay_conflict_tray_id != null ? res : null);
    },
  });

  if (!anyOpen && !anyDiscarded && !restoreResult) return null;

  return (
    <div className={styles.actions}>
      <div className={styles.buttons}>
        {anyOpen && (
          <Button
            size="sm"
            variant="ghost"
            disabled={skipReuse.isPending}
            onClick={() => skipReuse.mutate(!reuseSkipped)}
            title={
              reuseSkipped
                ? "Let Autoschedule reuse this tray's cells again"
                : "Planning to bin this tray? Autoschedule stops reusing it and opens fresh cells instead. Nothing is discarded - you can turn it back on."
            }
          >
            {reuseSkipped ? "Allow reuse again" : "Skip reuse"}
          </Button>
        )}
        {anyOpen && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>
            Discard all cells
          </Button>
        )}
        {anyDiscarded && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(true)}>
            Restore tray
          </Button>
        )}
      </div>

      {skipReuse.isError && (
        <Note tone="bad" icon="!" size="sm">
          {errorMessage(skipReuse.error, "Couldn't update the tray's reuse setting.")}
        </Note>
      )}

      {restoreResult && (
        <Note tone="warn" icon="!" size="sm">
          Tray restored.
          {restoreResult.drifted_use_ids.length > 0 &&
            ` ${restoreResult.drifted_use_ids.length} use(s) couldn't be moved back (already Confirm loaded or changed since) — left where they are.`}
          {restoreResult.bay_conflict_tray_id != null &&
            ` Tray ${restoreResult.bay_conflict_tray_id} is now also in this carousel bay — discard one so a single physical tray occupies it.`}
        </Note>
      )}

      {confirmDiscard && (
        <ConfirmModal
          title={`Discard all cells in tray ${trayId}?`}
          confirmLabel="Discard cells"
          confirmVariant="danger"
          pendingLabel="Discarding…"
          pending={discardMutation.isPending}
          error={discardMutation.isError ? errorMessage(discardMutation.error, "Couldn't discard the tray.") : null}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => discardMutation.mutate()}
        >
          <p>
            This marks every cell physically in this tray as exhausted, regardless of how many uses it has left. Any
            not-yet-run placements for these cells are cancelled and their samples return to the backlog. You can bring
            the cells back later with <b>Restore tray</b>, but the cancelled placements stay in the backlog to re-place.
          </p>
        </ConfirmModal>
      )}

      {confirmRestore && (
        <ConfirmModal
          title={`Restore tray ${trayId}?`}
          confirmLabel="Restore tray"
          pendingLabel="Restoring…"
          pending={restoreMutation.isPending}
          error={restoreMutation.isError ? errorMessage(restoreMutation.error, "Couldn't restore the tray.") : null}
          onCancel={() => setConfirmRestore(false)}
          onConfirm={() => restoreMutation.mutate()}
        >
          <Note tone="warn" icon="!">
            This un-discards the tray so its cells can be reused again. If it was discarded with the grid&apos;s{" "}
            <b>⏏</b> button, any later uses that moved onto a fresh tray move back here — unless they&apos;ve since been{" "}
            <b>Confirm loaded</b>. A hard &quot;Discard all cells&quot; cancelled its placements to the backlog; those
            samples stay there to re-place.
          </Note>
        </ConfirmModal>
      )}
    </div>
  );
}

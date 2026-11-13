import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { ApiError, errorMessage } from "@/api/client";
import { cellUsesApi, type RestoreItem, type RestoreOut } from "@/api/cellUses";
import { dismissToast, showToast } from "@/components/ui/Toast";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";

/**
 * The Schedule's one-step Undo. Holds a single entry - the last remove / move / swap / place -
 * offered on a toast ("3 samples removed · Undo"). A new edit replaces it; Autoschedule,
 * Recalculate and a day-note move clear it (their changes are too broad to undo safely, so an
 * older Undo must not linger past them). The entry lives exactly as long as its toast: once the
 * toast times out or is closed, there's nothing on screen to reach it.
 *
 * `undo` performs the inverse request and resolves to the sentence to confirm it with; every
 * inverse is re-validated server-side (a 409 if the schedule has moved on), so a failure is
 * reported, never forced.
 */

export type UndoFn = () => Promise<string>;

interface UndoEntry {
  undo: UndoFn;
  toastId: number;
}

let entry: UndoEntry | null = null;

/** Offer `undo` for the edit `message` describes, replacing any earlier offer. `onSettled` runs
 * after an undo attempt either way (the caller refreshes the grid). */
export function offerUndo(message: string, undo: UndoFn, onSettled?: () => void): void {
  const mine: UndoEntry = { undo, toastId: 0 };
  mine.toastId = showToast({
    message,
    action: {
      label: "Undo",
      onClick: () => void runUndo(mine, onSettled),
    },
  });
  entry = mine;
}

/** Forget the current offer (and close its toast, if it's still showing). */
export function clearUndo(): void {
  if (entry === null) return;
  dismissToast(entry.toastId);
  entry = null;
}

async function runUndo(target: UndoEntry, onSettled?: () => void): Promise<void> {
  if (entry !== target) return; // superseded, or already used - an Undo runs once
  entry = null;
  dismissToast(target.toastId);
  try {
    showToast({ message: await target.undo(), tone: "good" });
  } catch (err) {
    const message =
      err instanceof Error && !(err instanceof ApiError) ? `Couldn't undo. ${err.message}` : errorMessage(err, "Couldn't undo.");
    showToast({ message, tone: "bad" });
  } finally {
    onSettled?.();
  }
}

/** offerUndo / clearUndo bound to this page's query client, so an undo refreshes the grid. */
export function useUndoSlot() {
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      offer: (message: string, undo: UndoFn) => offerUndo(message, undo, () => invalidateScheduleRelated(queryClient)),
      clear: clearUndo,
    }),
    [queryClient],
  );
}

/** "1 sample" / "3 samples". */
export function samples(n: number): string {
  return `${n} sample${n === 1 ? "" : "s"}`;
}

/** The confirmation for a restore - naming any sample that came back on a different cell, so a
 * changed cell is never silent (its tray was cleared away with it, or a scheduling rule now
 * forbids the original - Help explains both). */
export function restoredMessage(res: RestoreOut): string {
  const changed = res.restored.filter((r) => r.cell_changed);
  const base = `Restored ${samples(res.restored.length)}`;
  if (changed.length === 0) return `${base}.`;
  const shown = changed.slice(0, 3).map((r) => `${r.from_cell_code ?? "?"} → ${r.to_cell_code}`);
  const more = changed.length > shown.length ? ` and ${changed.length - shown.length} more` : "";
  return `${base} — ${changed.length} on a different cell (${shown.join(", ")}${more}).`;
}

/** Undo for a bulk-remove: put its snapshot back. */
export function restoreUndo(snapshot: RestoreItem[]): UndoFn {
  return async () => restoredMessage(await cellUsesApi.restore(snapshot));
}

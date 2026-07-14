import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

export interface ClearScheduleModalProps {
  /** e.g. "14 Jul – 27 Jul". */
  weekLabel: string;
  /** Number of placed, unlocked samples in the current week that would be removed. */
  count: number;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirms the destructive "Clear schedule" action before wiping every planned
 * (unlocked) placement in the currently-viewed week. Locked/confirmed-loaded runs are
 * never touched, so the count here may be lower than the week's total placements. */
export function ClearScheduleModal({ weekLabel, count, pending, error, onCancel, onConfirm }: ClearScheduleModalProps) {
  return (
    <Modal onClose={pending ? () => {} : onCancel} title="Clear this week's schedule?">
      <p>
        This will remove all {count} planned sample{count === 1 ? "" : "s"} from{" "}
        <b>{weekLabel}</b> and return them to the backlog. Confirmed/loaded runs are left as-is. This can&apos;t be
        undone.
      </p>

      {error !== null && error !== undefined && (
        <Note tone="bad" icon="!">
          {error instanceof ApiError ? error.message : "Failed to clear schedule."}
        </Note>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={pending || count === 0}>
          {pending ? "Clearing…" : `Delete ${count} sample${count === 1 ? "" : "s"}`}
        </Button>
      </ModalActions>
    </Modal>
  );
}

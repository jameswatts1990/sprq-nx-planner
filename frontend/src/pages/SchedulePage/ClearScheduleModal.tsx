import { errorMessage } from "@/api/client";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

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
  const samples = `${count} sample${count === 1 ? "" : "s"}`;
  return (
    <ConfirmModal
      title="Clear this week's schedule?"
      confirmLabel={`Return ${samples} to backlog`}
      confirmVariant="danger"
      pendingLabel="Returning…"
      pending={pending}
      confirmDisabled={count === 0}
      error={error !== null && error !== undefined ? errorMessage(error, "Couldn't clear the schedule.") : null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        This will remove all {count} planned sample{count === 1 ? "" : "s"} from <b>{weekLabel}</b> and return them to
        the backlog. Confirmed/loaded runs are left as-is. You can Undo it from the message that appears straight
        after.
      </p>
    </ConfirmModal>
  );
}

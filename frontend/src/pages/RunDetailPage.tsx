import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { SLOT_INDICES } from "@/components/scheduler/gridKeys";
import { padStages } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { runLabel } from "@/utils/runLabel";

import styles from "./RunDetailPage.module.css";

/** Read-only detail for a single run (Cycle): its up-to-4 stages rendered with the same
 * SchedulerSlotView leaf used interactively in the grid. No KPI strip - a single day's
 * run has no coherent lifetime-cost figure. */
export function RunDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const id = Number(cycleId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["cycle", id],
    queryFn: () => cyclesApi.get(id),
    enabled: idIsValid,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cyclesApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cycle", id] });
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          Invalid run id.
        </Note>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className={styles.status}>Loading run…</div>;
  }

  if (query.isError) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load run."}
        </Note>
      </div>
    );
  }

  const cycle = query.data;
  if (!cycle) {
    return <div className={styles.status}>Run not found.</div>;
  }

  const slots = padStages(cycle);
  const canCancel = cycle.status === "planned";

  return (
    <div className={styles.page}>
      <div className={styles.metaRow}>
        <span>
          Run <b>{runLabel(cycle)}</b>
          {cycle.run_name && <span className={styles.meta}> (#{cycle.cycle_id})</span>}
        </span>
        <span>
          Instrument <b>{cycle.instrument_serial}</b>
        </span>
        <span>
          Run date <b>{cycle.run_date}</b>
        </span>
        <span>
          Status <Badge tone={CYCLE_STATUS_TONE[cycle.status]}>{cycle.status}</Badge>
        </span>
        <span>
          Active now <b>{cycle.is_locked ? "Yes" : "No"}</b>
        </span>
        <span>
          Movie <b>{cycle.movie_hours} h</b>
        </span>
        <span>
          Planned <b>{new Date(cycle.planned_start_at).toLocaleString()}</b> →{" "}
          <b>{new Date(cycle.planned_end_at).toLocaleString()}</b>
        </span>
        <div className={styles.cancelRow}>
          {canCancel && (
            <Button variant="ghost" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel run"}
            </Button>
          )}
        </div>
      </div>

      {cancelMutation.isError && (
        <Note tone="bad" icon="!">
          {cancelMutation.error instanceof ApiError ? cancelMutation.error.message : "Failed to cancel run."}
        </Note>
      )}

      <SectionHeading title="Run slots" legend={<UseLegend />} />
      <div className={styles.runSlots}>
        {SLOT_INDICES.map((i) => (
          <SchedulerSlotView key={i} stage={slots[i]} slotIndex={i} locked />
        ))}
      </div>
    </div>
  );
}

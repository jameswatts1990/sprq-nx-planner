import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { PLATE_INDICES } from "@/components/scheduler/gridKeys";
import { padStages } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { runLabel } from "@/utils/runLabel";

import styles from "./RunDetailPage.module.css";

/** Read-only detail for a single run (RunBatch): its 1-2 plates, each rendered with the same
 * SchedulerSlotView leaf used interactively in the grid. No KPI strip - a single run has no
 * coherent lifetime-cost figure. */
export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const id = Number(runId);
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
      invalidateScheduleRelated(queryClient);
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

  const run = query.data;
  if (!run) {
    return <div className={styles.status}>Run not found.</div>;
  }

  const slots = padStages(run);
  const canCancel = run.status === "planned";

  return (
    <div className={styles.page}>
      <div className={styles.metaRow}>
        <span>
          Run <b>{runLabel(run)}</b>
          {run.run_name && <span className={styles.meta}> (#{run.run_id})</span>}
        </span>
        <span>
          Instrument <b>{run.instrument_serial}</b>
        </span>
        <span>
          Load date <b>{run.load_date}</b>
        </span>
        <span>
          Status <Badge tone={CYCLE_STATUS_TONE[run.status]}>{run.status}</Badge>
        </span>
        <span>
          Active now <b>{run.is_locked ? "Yes" : "No"}</b>
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

      <SectionHeading title="Run plates" legend={<UseLegend />} />
      <div className={styles.plates}>
        {PLATE_INDICES.map((indices, plateIdx) => {
          const plate = run.plates.find((p) => p.plate_index === plateIdx + 1);
          return (
            <div key={plateIdx} className={styles.plate}>
              <div className={styles.plateHead}>
                <span className={styles.plateTitle}>Plate {plateIdx + 1}</span>
                {plate ? (
                  <span className={styles.plateMeta}>
                    acquires <b>{plate.acquire_date}</b> · {plate.movie_hours} h
                    {plate.is_reuse && <span className={styles.reuse}> · reuse</span>}
                  </span>
                ) : (
                  <span className={styles.plateMeta}>—</span>
                )}
              </div>
              <div className={styles.runSlots}>
                {indices.map((i) => (
                  <SchedulerSlotView key={i} stage={slots[i]} slotIndex={i} locked />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

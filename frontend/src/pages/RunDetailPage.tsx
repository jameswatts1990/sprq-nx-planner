import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { schedulesApi } from "@/api/schedules";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import { UseRow } from "@/components/cells/UseRow";
import { ScheduleKpiTiles } from "@/components/shared/ScheduleKpiTiles";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Note } from "@/components/ui/Note";
import type { CycleOut } from "@/types/schedule";

import styles from "./RunDetailPage.module.css";

interface CellBreakdown {
  cellRef: string;
  cellId: number | null;
  isPrior: boolean;
  uses: { useNumber: number; sampleExternalId: string; barcodes: string[] }[];
}

/** ScheduleDetailOut doesn't nest cells the way PreviewResponse does, so the cell
 * breakdown for a committed run is built locally from cycles.flatMap(stages). */
function groupStagesByCell(cycles: CycleOut[]): CellBreakdown[] {
  const map = new Map<string, CellBreakdown>();

  for (const cycle of cycles) {
    for (const stage of cycle.stages) {
      const key = stage.cell_id !== null ? `id:${stage.cell_id}` : `ref:${stage.cell_ref}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { cellRef: stage.cell_ref, cellId: stage.cell_id, isPrior: stage.cell_is_prior, uses: [] };
        map.set(key, entry);
      }
      entry.uses.push({
        useNumber: cycle.use_idx + 1,
        sampleExternalId: stage.sample_external_id ?? "—",
        barcodes: stage.barcodes,
      });
    }
  }

  const list = [...map.values()];
  for (const entry of list) {
    entry.uses.sort((a, b) => a.useNumber - b.useNumber);
  }
  list.sort((a, b) => a.cellRef.localeCompare(b.cellRef, undefined, { numeric: true }));
  return list;
}

export function RunDetailPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const id = Number(scheduleId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["schedule", id],
    queryFn: () => schedulesApi.get(id),
    enabled: idIsValid,
  });

  const cancelMutation = useMutation({
    mutationFn: () => schedulesApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", id] });
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          Invalid schedule id.
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

  const schedule = query.data;
  if (!schedule) {
    return <div className={styles.status}>Run not found.</div>;
  }

  const canCancel = schedule.status === "active" && !schedule.cycles.some((c) => c.actual_start_at !== null);
  const instrumentSerials = [...new Set(schedule.cycles.map((c) => c.instrument_serial))].sort();
  const cellBreakdown = groupStagesByCell(schedule.cycles);

  return (
    <div className={styles.page}>
      <div className={styles.metaRow}>
        <span>
          Run <b>#{schedule.id}</b>
        </span>
        <span>
          Created by <b>{schedule.created_by}</b> on <b>{new Date(schedule.created_at).toLocaleString()}</b>
        </span>
        <span>
          Status <Badge tone={schedule.status === "active" ? "success" : "default"}>{schedule.status}</Badge>
        </span>
        <span>
          Start date <b>{schedule.start_date}</b>
        </span>
        <div className={styles.cancelRow}>
          {canCancel && (
            <Button variant="ghost" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel schedule"}
            </Button>
          )}
        </div>
      </div>

      {cancelMutation.isError && (
        <Note tone="bad" icon="!">
          {cancelMutation.error instanceof ApiError ? cancelMutation.error.message : "Failed to cancel schedule."}
        </Note>
      )}

      {schedule.kpi && (
        <KpiStrip>
          <ScheduleKpiTiles kpi={schedule.kpi} />
        </KpiStrip>
      )}

      <SectionHeading title="Weekly schedule" legend={<UseLegend />} />
      <ScheduleCalendar cycles={schedule.cycles} instrumentSerials={instrumentSerials} startDate={schedule.start_date} />

      <SectionHeading
        title="Cell loading map"
        legend={<span>Each cell&apos;s uses carry unique barcodes - no carryover clash</span>}
      />
      {cellBreakdown.length === 0 ? (
        <div className={styles.status}>No cells recorded for this run.</div>
      ) : (
        <div className={styles.cellGrid}>
          {cellBreakdown.map((cell) => (
            <div key={cell.cellId ?? cell.cellRef} className={styles.cellCard}>
              <div className={cell.isPrior ? `${styles.cellHead} ${styles.prior}` : styles.cellHead}>
                <span className={styles.cid}>{cell.cellRef}</span>
                {cell.isPrior && <span className={styles.priorTag}>IN PROGRESS</span>}
                {cell.cellId !== null && (
                  <Link to={`/cells/${cell.cellId}`} className={styles.cellLink}>
                    View cell →
                  </Link>
                )}
              </div>
              <div className={styles.cellBody}>
                {cell.uses.map((u, i) => (
                  <UseRow key={i} useNumber={u.useNumber} sampleExternalId={u.sampleExternalId} barcodes={u.barcodes} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { CellQcModal } from "@/components/cells/CellQcModal";
import { CellInfoPopover } from "@/components/scheduler/CellInfoPopover";
import { PLATE_INDICES } from "@/components/scheduler/gridKeys";
import { padStages } from "@/components/scheduler/groupCyclesByInstrumentAndDay";
import { SchedulerSlotView } from "@/components/scheduler/SchedulerSlotView";
import { SlotDetailPopover } from "@/components/scheduler/SlotDetailPopover";
import { SectionHeading, UseLegend } from "@/components/shared/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import { ViewActivityLink } from "@/pages/HistoryActivityPage/ViewActivityLink";
import type { PlateOut, RunOut, StageOut } from "@/types/schedule";
import {
  formatShortDateTimeLocal,
  formatShortDateUTC,
  formatTimeLocal,
  parseDateOnly,
  shortWeekdayUTC,
} from "@/utils/calendarDates";
import { CYCLE_STATUS_TONE } from "@/utils/cycleStatus";
import { runLabel } from "@/utils/runLabel";
import { resolveBackNav } from "@/utils/sampleBackNav";

import styles from "./RunDetailPage.module.css";

interface StageTarget {
  stage: StageOut;
  run: RunOut;
}
interface QcTarget {
  cellId: number;
  cellUseId: number | null;
}

/** Read-only detail for a single run (RunBatch): its 1-2 plates, each rendered with the same
 * SchedulerSlotView leaf used interactively in the grid - framed as the grid's vertical tray
 * blocks (Plate label + reuse/acquire tags) and wired for the same drill-through: click a card
 * for its placement detail, click the holographic stub for the physical cell, open Cell QC from
 * either. The popovers gate every mutating action on run.status === "planned", so on a
 * completed/aborted run they degrade to read-only. No KPI strip - a single run has no coherent
 * lifetime-cost figure. */
export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const id = Number(runId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Back to wherever the run was opened from (Run history with its filters, a cell, a sample);
  // a direct link falls back to Run history.
  const back = resolveBackNav(useLocation().state, { to: "/history/runs", label: "Run history" });

  const [detail, setDetail] = useState<StageTarget | null>(null);
  const [cellInfo, setCellInfo] = useState<StageTarget | null>(null);
  const [qcTarget, setQcTarget] = useState<QcTarget | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const query = useQuery({
    queryKey: ["cycle", id],
    queryFn: () => cyclesApi.get(id),
    enabled: idIsValid,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cyclesApi.cancel(id),
    onSuccess: () => {
      invalidateScheduleRelated(queryClient);
      // The run is deleted, so this page has nothing left to show.
      navigate(back.to);
    },
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <PageHeader title="Run" back={back} />
        <Note tone="bad" icon="!">
          Invalid run id.
        </Note>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className="status">Loading run…</div>;
  }

  if (query.isError) {
    return (
      <div className={styles.page}>
        <PageHeader title={`Run #${id}`} back={back} />
        <Note tone="bad" icon="!">
          {errorMessage(query.error, "Couldn't load the run.")}
        </Note>
      </div>
    );
  }

  const run = query.data;
  if (!run) {
    return <div className="status">Run not found.</div>;
  }

  const slots = padStages(run);
  const canCancel = run.status === "planned";
  const stages = run.plates.flatMap((p) => p.stages);
  // What Cancel run returns to the backlog; a stopped cell's Blocked marker is kept (cancel_run).
  const returning = stages.filter((s) => s.cell_use_status !== "cancelled" && s.sample_id != null).length;
  const keepsMarkers = stages.some((s) => s.cell_use_status === "cancelled");
  const plate1 = run.plates.find((p) => p.plate_index === 1) ?? run.plates[0];

  return (
    <div className={styles.page}>
      <PageHeader
        title={run.run_name ?? `Run #${run.run_id}`}
        back={back}
        actions={
          <>
            <ViewActivityLink kind="run" id={run.run_id} label={run.run_name ?? `Run #${run.run_id}`} />
            {canCancel && (
              <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={cancelMutation.isPending}>
                Cancel run
              </Button>
            )}
          </>
        }
      />
      <div className={styles.metaRow}>
        {/* A named run's title is its name, so its number lives here. */}
        {run.run_name && (
          <span>
            Run <b>#{run.run_id}</b>
          </span>
        )}
        <span>
          Instrument <b>{run.instrument_serial}</b>
        </span>
        <span>
          Load date <b>{run.load_date}</b>
        </span>
        {plate1 && (
          <span>
            Loads &amp; starts <b>{formatShortDateTimeLocal(plate1.actual_start_at ?? plate1.planned_start_at)}</b>
          </span>
        )}
        <span>
          Cells <b>{run.cell_type === "sprq" ? "SPRQ (single use)" : "SPRQ-Nx"}</b>
        </span>
        <span>
          Status <Badge tone={CYCLE_STATUS_TONE[run.status]}>{run.status}</Badge>
        </span>
        <span>
          Active now <b>{run.is_locked ? "Yes" : "No"}</b>
        </span>
      </div>

      {confirmingCancel && (
        <ConfirmModal
          title={`Cancel run ${runLabel(run)}?`}
          confirmLabel="Cancel run"
          cancelLabel="Keep run"
          confirmVariant="danger"
          pendingLabel="Cancelling…"
          pending={cancelMutation.isPending}
          error={cancelMutation.isError ? errorMessage(cancelMutation.error, "Couldn't cancel the run.") : null}
          onCancel={() => setConfirmingCancel(false)}
          onConfirm={() => cancelMutation.mutate()}
        >
          <p>
            <b>
              {returning} sample{returning === 1 ? "" : "s"}
            </b>{" "}
            return{returning === 1 ? "s" : ""} to the backlog; the run is deleted.
            {keepsMarkers && " Its Blocked markers (stopped cells) are kept."}
          </p>
        </ConfirmModal>
      )}

      <SectionHeading title="Run plates" legend={<UseLegend />} />
      <div className={styles.plates}>
        {PLATE_INDICES.map((indices, plateIdx) => {
          const plate = run.plates.find((p) => p.plate_index === plateIdx + 1);
          const acquiresElsewhere = plate && plate.acquire_date !== run.load_date;
          return (
            <div key={plateIdx} className={styles.tray}>
              <div className={styles.trayHeader}>
                <div className={styles.plateLabelWrap}>
                  <span className={styles.trayLabel}>Plate {plateIdx + 1}</span>
                  {acquiresElsewhere && (
                    <span
                      className={styles.acquireTag}
                      title={
                        plate!.is_reuse
                          ? `Runs after Plate 1's movie finishes and the cells are washed — starts ${formatShortDateTimeLocal(plate!.planned_start_at)}.`
                          : `Plate ${plate!.plate_index} acquires on ${shortWeekdayUTC(parseDateOnly(plate!.acquire_date))} ${formatShortDateUTC(parseDateOnly(plate!.acquire_date))}`
                      }
                    >
                      → {shortWeekdayUTC(parseDateOnly(plate!.acquire_date))} {formatShortDateUTC(parseDateOnly(plate!.acquire_date))}
                    </span>
                  )}
                </div>
                {plate && <PlateTiming plate={plate} />}
              </div>

              <div className={styles.runSlots}>
                {indices.map((i) => {
                  const stage = slots[i];
                  return (
                    <SchedulerSlotView
                      key={i}
                      stage={stage}
                      slotIndex={i}
                      locked
                      className={stage ? styles.clickable : undefined}
                      role={stage ? "button" : undefined}
                      tabIndex={stage ? 0 : undefined}
                      onClick={stage ? () => setDetail({ stage, run }) : undefined}
                      onKeyDown={
                        stage
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setDetail({ stage, run });
                              }
                            }
                          : undefined
                      }
                      onOpenCell={stage ? () => setCellInfo({ stage, run }) : undefined}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <SlotDetailPopover
          stage={detail.stage}
          run={detail.run}
          onClose={() => setDetail(null)}
          onOpenQc={(cellId, cellUseId) => setQcTarget({ cellId, cellUseId })}
        />
      )}
      {cellInfo && (
        <CellInfoPopover
          stage={cellInfo.stage}
          run={cellInfo.run}
          onClose={() => setCellInfo(null)}
          onOpenQc={(cellId, cellUseId) => setQcTarget({ cellId, cellUseId })}
        />
      )}
      {qcTarget && (
        <CellQcModal
          cellId={qcTarget.cellId}
          cellUseId={qcTarget.cellUseId}
          onClose={() => setQcTarget(null)}
          onApplied={() => invalidateScheduleRelated(queryClient)}
        />
      )}
    </div>
  );
}

/** The plate's loading window — planned start→end always, plus actual start/end once a run has
 * begun/finished (a completed run carries both). Longest movie length shown alongside. */
function PlateTiming({ plate }: { plate: PlateOut }) {
  return (
    <span className={styles.timing}>
      <span title="Planned start → end of this plate's movie">
        {formatShortDateTimeLocal(plate.planned_start_at)} → {formatTimeLocal(plate.planned_end_at)}
      </span>
      <span className={styles.movie}>{plate.movie_hours} h</span>
      {plate.actual_start_at && (
        <span className={styles.actual} title="Actual start → end recorded on the instrument">
          actual {formatShortDateTimeLocal(plate.actual_start_at)}
          {plate.actual_end_at ? ` → ${formatTimeLocal(plate.actual_end_at)}` : ""}
        </span>
      )}
    </span>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { CellQcModal } from "@/components/cells/CellQcModal";
import { WindowMeter } from "@/components/cells/WindowMeter";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { CellDetailOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { plateWellFromPlate, plateWellFromWell } from "@/utils/plateWell";
import { runLabel } from "@/utils/runLabel";
import { useSampleBackNav } from "@/utils/sampleBackNav";
import { USE_STATUS_TONE } from "@/utils/useStatusTone";

import styles from "./CellDetailPage.module.css";

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/** Drafts the PacBio outreach email from the use that triggered the credit case - the
 * most recent Failed use, or (for a Stopped cell with no Failed use) the most recent use
 * overall - so the well/run/instrument/date in the email match what the lab actually saw. */
function buildCreditEmail(cell: CellDetailOut): { subject: string; body: string } {
  const uses = cell.use_history;
  const relevantUse = [...uses].reverse().find((u) => u.status === "failed") ?? uses[uses.length - 1] ?? null;

  const well = relevantUse ? plateWellFromPlate(relevantUse.plate_index, relevantUse.well, { qualified: true }) : "—";
  const run = relevantUse ? runLabel({ run_id: relevantUse.run_batch_id, run_name: relevantUse.run_name }) : "—";
  const instrument = relevantUse?.instrument_serial ?? "—";
  const runDate = relevantUse ? formatDateTime(relevantUse.started_at ?? relevantUse.completed_at) : "—";

  const subject = `SMRT Cell issue – ${cell.code}`;
  const body = [
    `Cell issue on well ${well}, run ${run}, ${instrument}, ${runDate}.`,
    "",
    "Please advise on how to proceed and if a credit will be given.",
    "",
    `Cell: ${cell.code}`,
    cell.pacbio_case_number ? `Case number: ${cell.pacbio_case_number}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, body };
}

export function CellDetailPage() {
  const { cellId } = useParams<{ cellId: string }>();
  const id = Number(cellId);
  const idIsValid = Number.isFinite(id);
  const queryClient = useQueryClient();
  const backNav = useSampleBackNav();

  const query = useQuery({
    queryKey: ["cell", id],
    queryFn: () => cellsApi.get(id),
    enabled: idIsValid,
  });

  const trayId = query.data?.tray_id ?? null;

  const [qcOpen, setQcOpen] = useState(false);
  const [caseNumber, setCaseNumber] = useState("");

  function invalidateCell() {
    invalidateScheduleRelated(queryClient);
  }

  const reportMutation = useMutation({
    mutationFn: (caseNum: string) => cellsApi.reportToPacbio(id, { case_number: caseNum }),
    onSuccess: () => {
      invalidateCell();
      setCaseNumber("");
    },
  });

  const confirmCreditMutation = useMutation({
    mutationFn: () => cellsApi.confirmCredit(id),
    onSuccess: invalidateCell,
  });

  const receiveCreditMutation = useMutation({
    mutationFn: () => cellsApi.receiveCredit(id),
    onSuccess: invalidateCell,
  });

  if (!idIsValid) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          Invalid cell id.
        </Note>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className={styles.status}>Loading cell…</div>;
  }

  if (query.isError) {
    return (
      <div className={styles.page}>
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load cell."}
        </Note>
      </div>
    );
  }

  const cell = query.data;
  if (!cell) {
    return <div className={styles.status}>Cell not found.</div>;
  }

  const isTerminal = cell.status === "retired" || cell.status === "stopped";
  const showCreditCard = cell.has_failed_use || cell.status === "stopped";
  // An open case (not yet reported, or reported but credit not yet received) is the thing the
  // lab needs to act on next, so it jumps to the top of the page; once credit's received it's
  // a resolved historical record and settles back to its normal spot after use history.
  const isCreditCaseOpen = showCreditCard && !cell.credit_received_at;
  const creditEmail = buildCreditEmail(cell);
  const creditEmailHref = `mailto:?subject=${encodeURIComponent(creditEmail.subject)}&body=${encodeURIComponent(creditEmail.body)}`;
  const showWindowMeter =
    cell.status !== "exhausted" &&
    cell.status !== "retired" &&
    cell.status !== "stopped" &&
    cell.window_hours_elapsed !== null;

  const mainCard = (
    <Card>
      <CardHeader badge={<Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>}>
        <h2>{cell.code}</h2>
      </CardHeader>
      <CardBody>
        {cell.stopped_reason && (
          <Note tone="warn" icon="!">
            {cell.status === "retired" ? "Retired" : "Stopped"}: {cell.stopped_reason}
          </Note>
        )}

        <div className={styles.headerGrid}>
          <div>
            <span className={styles.label}>Uses</span>
            <span className={styles.value}>
              {cell.uses_consumed} / {cell.max_uses} ({cell.uses_remaining} remaining)
            </span>
          </div>
          {!showWindowMeter && (
            <>
              <div>
                <span className={styles.label}>Window elapsed</span>
                <span className={styles.value}>
                  {cell.window_hours_elapsed !== null ? `${cell.window_hours_elapsed.toFixed(1)} h` : "—"}
                </span>
              </div>
              <div>
                <span className={styles.label}>Window breached</span>
                <span className={styles.value}>{cell.window_breached ? "Yes" : "No"}</span>
              </div>
            </>
          )}
          <div>
            <span className={styles.label}>Current location</span>
            <span className={styles.value}>
              {cell.current_instrument_serial
                ? `${cell.current_instrument_serial}${cell.current_well ? ` · ${plateWellFromWell(cell.current_well, { qualified: true })}` : ""}`
                : "—"}
            </span>
          </div>
          {trayId !== null && (
            <div>
              <span className={styles.label}>Tray</span>
              <Link to={`/cells?tray=${trayId}`} className={`${styles.value} link`}>
                Tray {trayId}
              </Link>
            </div>
          )}
          <div>
            <span className={styles.label}>First use started</span>
            <span className={styles.value}>{formatDateTime(cell.first_use_started_at)}</span>
          </div>
          <div>
            <span className={styles.label}>Created</span>
            <span className={styles.value}>{formatDateTime(cell.created_at)}</span>
          </div>
          {isTerminal && cell.stopped_at && (
            <div>
              <span className={styles.label}>{cell.status === "retired" ? "Retired" : "Stopped"}</span>
              <span className={styles.value}>{formatDateTime(cell.stopped_at)}</span>
            </div>
          )}
        </div>

        {showWindowMeter && <WindowMeter windowHours={cell.window_hours_elapsed as number} />}

        {cell.burned_barcodes.length > 0 && (
          <div className={styles.burnedRow}>
            <span className={styles.label}>Burned barcodes</span>
            <BarcodeChips barcodes={cell.burned_barcodes} />
          </div>
        )}

        <div className={styles.retireRow}>
          <Button variant="ghost" onClick={() => setQcOpen(true)}>
            {isTerminal ? "Cell QC (undo)…" : "Cell QC…"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );

  const useHistoryCard = (
    <Card>
      <CardHeader>
        <h2>Use history</h2>
      </CardHeader>
      <CardBody>
        {cell.use_history.length === 0 ? (
          <div className={styles.status}>No uses recorded yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Well</th>
                  <th>Status</th>
                  <th>Container ID</th>
                  <th>Barcodes</th>
                  <th>Priority</th>
                  <th>Target OPLC</th>
                  <th>Adaptive Loading</th>
                  <th>Full Res. Base Q</th>
                  <th>Include Base Kinetics</th>
                  <th>Instrument</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {cell.use_history.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/history/runs/${u.run_batch_id}`} className="link">
                        {runLabel({ run_id: u.run_batch_id, run_name: u.run_name })}
                      </Link>
                    </td>
                    <td className={styles.mono}>{plateWellFromPlate(u.plate_index, u.well, { qualified: true })}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <Badge tone={USE_STATUS_TONE[u.status] ?? "default"}>{u.status}</Badge>
                        {u.reassigned && <Badge tone="info">reassigned</Badge>}
                        {u.barcode_clash && <Badge tone="danger">clash</Badge>}
                      </div>
                    </td>
                    <td>
                      {u.sample_id !== null && u.sample_external_id !== null ? (
                        <Link to={`/samples/${u.sample_id}`} state={backNav} className="link">
                          {u.sample_external_id}
                        </Link>
                      ) : (
                        (u.sample_external_id ?? "—")
                      )}
                    </td>
                    <td>
                      <BarcodeChips barcodes={u.barcodes} />
                    </td>
                    <td>{u.sample_priority ?? "—"}</td>
                    <td>{u.sample_target_oplc ?? "—"}</td>
                    <td>{u.sample_adaptive_loading ?? "—"}</td>
                    <td>{u.sample_full_resolution_base_q ?? "—"}</td>
                    <td>{u.sample_base_kinetics ?? "—"}</td>
                    <td>{u.instrument_serial ?? "—"}</td>
                    <td>{formatDateTime(u.started_at)}</td>
                    <td>{formatDateTime(u.completed_at)}</td>
                    <td>{u.outcome_notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );

  const creditCard = showCreditCard && (
    <Card>
      <CardHeader badge={isCreditCaseOpen ? <Badge tone="warning">Open</Badge> : undefined}>
        <h2>PacBio credit</h2>
      </CardHeader>
      <CardBody>
        <div className={styles.creditGrid}>
          <div>
            <span className={styles.label}>Case number</span>
            <span className={styles.value}>{cell.pacbio_case_number ?? "—"}</span>
          </div>
          <div>
            <span className={styles.label}>Reported to PacBio</span>
            <span className={styles.value}>{formatDateTime(cell.pacbio_reported_at)}</span>
          </div>
          <div>
            <span className={styles.label}>Credit confirmed</span>
            <span className={styles.value}>{formatDateTime(cell.pacbio_credit_confirmed_at)}</span>
          </div>
          <div>
            <span className={styles.label}>Credit received</span>
            <span className={styles.value}>{formatDateTime(cell.credit_received_at)}</span>
          </div>
        </div>

        {!cell.pacbio_case_number ? (
          <div className={styles.creditActions}>
            <input
              type="text"
              className={styles.caseInput}
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="Case number, e.g. CS-000123"
            />
            <Button
              variant="primary"
              onClick={() => reportMutation.mutate(caseNumber)}
              disabled={!caseNumber.trim() || reportMutation.isPending}
            >
              {reportMutation.isPending ? "Reporting…" : "Report to PacBio"}
            </Button>
            <a className="btn ghost" href={creditEmailHref}>
              Generate email…
            </a>
          </div>
        ) : (
          <div className={styles.creditActions}>
            {!cell.pacbio_credit_confirmed_at && (
              <Button
                variant="ghost"
                onClick={() => confirmCreditMutation.mutate()}
                disabled={confirmCreditMutation.isPending}
              >
                {confirmCreditMutation.isPending ? "Confirming…" : "Confirm credit"}
              </Button>
            )}
            {!cell.credit_received_at && (
              <Button
                variant="ghost"
                onClick={() => receiveCreditMutation.mutate()}
                disabled={receiveCreditMutation.isPending}
              >
                {receiveCreditMutation.isPending ? "Marking…" : "Mark credit received"}
              </Button>
            )}
            <a className="btn ghost" href={creditEmailHref}>
              Generate email…
            </a>
          </div>
        )}

        {reportMutation.isError && (
          <Note tone="bad" icon="!">
            {reportMutation.error instanceof ApiError ? reportMutation.error.message : "Failed to report to PacBio."}
          </Note>
        )}
        {confirmCreditMutation.isError && (
          <Note tone="bad" icon="!">
            {confirmCreditMutation.error instanceof ApiError
              ? confirmCreditMutation.error.message
              : "Failed to confirm credit."}
          </Note>
        )}
        {receiveCreditMutation.isError && (
          <Note tone="bad" icon="!">
            {receiveCreditMutation.error instanceof ApiError
              ? receiveCreditMutation.error.message
              : "Failed to mark credit received."}
          </Note>
        )}
      </CardBody>
    </Card>
  );

  return (
    <div className={styles.page}>
      {isCreditCaseOpen && creditCard}
      {mainCard}
      {useHistoryCard}
      {!isCreditCaseOpen && creditCard}

      {qcOpen && <CellQcModal cellId={id} onClose={() => setQcOpen(false)} />}
    </div>
  );
}

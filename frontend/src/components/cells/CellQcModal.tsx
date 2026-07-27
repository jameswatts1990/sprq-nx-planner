import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { BarcodeChips } from "@/components/shared/BarcodeChips";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SegmentedOption } from "@/components/ui/SegmentedControl";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { AffectedSample, Disposition, QcPreviewOut, QcVerdict } from "@/types/qc";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { canRecordQcOutcome } from "@/utils/cellUseQc";

import styles from "./CellQcModal.module.css";

type RowChoice = Disposition | "keep";

const REQUIRED_OPTIONS: SegmentedOption<Disposition>[] = [
  { value: "lost", label: "Lost", hint: "Top-up" },
  { value: "repeatable", label: "Repeatable", hint: "Backlog" },
  { value: "recoverable", label: "Recoverable", hint: "Backlog" },
];
const FLAGGED_OPTIONS: SegmentedOption<RowChoice>[] = [
  { value: "keep", label: "Keep" },
  { value: "lost", label: "Lost" },
  { value: "repeatable", label: "Repeatable" },
  { value: "recoverable", label: "Recoverable" },
];

export interface CellQcModalProps {
  cellId: number;
  /** The specific use QC was opened from (a grid stub / card). Omit for a whole-cell entry
   * (tray overview, cell page) - Fail / Fail-and-Stop then target the cell's current
   * failable use. */
  cellUseId?: number | null;
  onClose: () => void;
  /** Fired after a successful commit/undo, so an opener can also close a parent popover. */
  onApplied?: () => void;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

/**
 * The single Cell QC flow, keyed off a cell id so every entry point (grid ticket-stub, the
 * left tray overview, and the Cell detail page) opens the same dialog. Two phases: choose a
 * verdict (Fail / Fail-and-Stop / Retire), then - if the verdict costs any samples - decide
 * each one's fate (Lost -> top-up, Repeatable/Recoverable -> backlog). Preview is read-only and
 * commit is atomic, so closing mid-flow applies nothing.
 */
export function CellQcModal({ cellId, cellUseId, onClose, onApplied }: CellQcModalProps) {
  const queryClient = useQueryClient();
  const cellQuery = useQuery({ queryKey: ["cell", cellId], queryFn: () => cellsApi.get(cellId) });
  const cell = cellQuery.data;

  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<"choose" | "disposition">("choose");
  const [verdict, setVerdict] = useState<QcVerdict | null>(null);
  const [preview, setPreview] = useState<QcPreviewOut | null>(null);
  const [choices, setChoices] = useState<Record<number, RowChoice>>({});

  // Which use Fail / Fail-and-Stop anchors on: the one QC was opened from, else the cell's
  // most recent still-failable use (its uses are chronological, so the last is "current").
  const failable = useMemo(() => (cell?.use_history ?? []).filter(canRecordQcOutcome), [cell]);
  const targetUseId = cellUseId ?? (failable.length ? failable[failable.length - 1].id : null);
  const targetUse = cell?.use_history.find((u) => u.id === targetUseId) ?? null;
  const canFail = !!targetUse && canRecordQcOutcome(targetUse);
  const isTerminal = cell ? cell.status === "stopped" || cell.status === "retired" : false;

  function anchorFor(v: QcVerdict): number | null {
    return v === "retire" ? cellUseId ?? null : targetUseId;
  }

  const invalidate = () => {
    invalidateScheduleRelated(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["topups"] });
  };

  const commitMutation = useMutation({
    mutationFn: (args: { v: QcVerdict; picks: Record<number, RowChoice> }) => {
      const dispositions: Record<number, Disposition> = {};
      for (const [sid, choice] of Object.entries(args.picks)) {
        if (choice !== "keep") dispositions[Number(sid)] = choice;
      }
      return cellsApi.qcCommit(cellId, {
        verdict: args.v,
        cell_use_id: anchorFor(args.v),
        reason: reason.trim() || null,
        dispositions,
      });
    },
    onSuccess: () => {
      invalidate();
      onApplied?.();
      onClose();
    },
  });

  const previewMutation = useMutation({
    mutationFn: (v: QcVerdict) => cellsApi.qcPreview(cellId, { verdict: v, cell_use_id: anchorFor(v) }),
    onSuccess: (data, v) => {
      setVerdict(v);
      if (!data.requires_disposition) {
        commitMutation.mutate({ v, picks: {} });
        return;
      }
      const init: Record<number, RowChoice> = {};
      for (const a of data.affected_samples) init[a.sample_id] = a.disposition_required ? "recoverable" : "keep";
      setChoices(init);
      setPreview(data);
      setPhase("disposition");
    },
  });

  const undoMutation = useMutation({
    mutationFn: () => cellsApi.qcUndo(cellId),
    onSuccess: () => {
      invalidate();
      onApplied?.();
      onClose();
    },
  });

  const busy = previewMutation.isPending || commitMutation.isPending || undoMutation.isPending;
  const error = previewMutation.error ?? commitMutation.error ?? undoMutation.error;
  const errorText = error instanceof ApiError ? error.message : error ? "Something went wrong." : null;

  const title = cell ? `QC · ${cell.code}` : "Cell QC";

  const required = preview?.affected_samples.filter((a) => a.disposition_required) ?? [];
  const flagged = preview?.affected_samples.filter((a) => !a.disposition_required) ?? [];

  function renderRow(a: AffectedSample, options: SegmentedOption<RowChoice>[] | SegmentedOption<Disposition>[]) {
    return (
      <div key={a.cell_use_id} className={`${styles.sampleRow} ${a.barcode_clash ? styles.clash : ""}`}>
        <div className={styles.sampleHead}>
          <span className={styles.sampleId}>{a.external_id ?? `Sample ${a.sample_id}`}</span>
          {a.role === "failed" && <Badge tone="orange">Failed run</Badge>}
          {a.role === "displaced" && <Badge tone="warning">Displaced</Badge>}
          {a.role === "reassigned" && <Badge tone="info">Reassigned</Badge>}
          {a.barcode_clash && <Badge tone="danger">Barcode clash</Badge>}
        </div>
        <div className={styles.meta}>
          <span>Use {a.use_number}</span>
          <span>{fmtDate(a.run_date)}</span>
          {a.instrument_serial && <span>{a.instrument_serial}</span>}
          {a.plate_index && <span>Plate {a.plate_index} · {a.well}</span>}
        </div>
        {a.barcodes.length > 0 && <BarcodeChips barcodes={a.barcodes} />}
        {a.reassigned && (
          <div className={styles.shift}>
            Planned {a.planned_cell_code ?? "?"} → ran on {a.actual_cell_code ?? "?"}
          </div>
        )}
        <SegmentedControl
          ariaLabel={`Disposition for ${a.external_id ?? a.sample_id}`}
          options={options as SegmentedOption<RowChoice>[]}
          value={choices[a.sample_id] ?? "keep"}
          onChange={(v) => setChoices((prev) => ({ ...prev, [a.sample_id]: v }))}
          fullWidth
        />
      </div>
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={title}
      titleExtra={cell ? <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge> : undefined}
      maxWidth={phase === "disposition" ? 760 : 460}
    >
      {cellQuery.isLoading && <div className={styles.intro}>Loading cell…</div>}
      {cellQuery.isError && <Note tone="bad" icon="!">Failed to load the cell.</Note>}

      {cell && phase === "choose" && (
        <>
          {isTerminal ? (
            <>
              <Note tone="warn" icon="!">
                This cell is <b>{CELL_STATUS_LABEL[cell.status]}</b>. Undo reopens it and restores the samples this
                QC action affected (any top-up whose request was already sent is left in place).
              </Note>
              {errorText && <Note tone="bad" icon="!">{errorText}</Note>}
              <ModalActions>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
                <Button variant="danger" onClick={() => undoMutation.mutate()} disabled={busy}>
                  {undoMutation.isPending ? "Undoing…" : "Undo QC"}
                </Button>
              </ModalActions>
            </>
          ) : (
            <>
              <p className={styles.intro}>
                {targetUse
                  ? `Fail / Fail-and-Stop act on Use ${cell.use_history.findIndex((u) => u.id === targetUse.id) + 1} (well ${targetUse.well}). Retire takes the whole cell out of service.`
                  : "This cell has no run that has started yet, so only Retire is available."}
              </p>
              <textarea
                className={styles.reason}
                placeholder="Reason / note (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className={styles.verdicts}>
                <button
                  type="button"
                  className={styles.verdictBtn}
                  disabled={busy || !canFail}
                  title={canFail ? undefined : "Available once the run is confirmed loaded"}
                  onClick={() => previewMutation.mutate("fail")}
                >
                  <b>Fail Cell</b>
                  <small>Mark this run failed. The cell stays open for its other uses.</small>
                </button>
                <button
                  type="button"
                  className={styles.verdictBtn}
                  disabled={busy || !canFail}
                  title={canFail ? undefined : "Available once the run is confirmed loaded"}
                  onClick={() => previewMutation.mutate("fail_and_stop")}
                >
                  <b>Fail and Stop Cell</b>
                  <small>Mark this run failed and stop the cell — its later scheduled uses shift or drop off.</small>
                </button>
                <button
                  type="button"
                  className={styles.verdictBtn}
                  disabled={busy}
                  onClick={() => previewMutation.mutate("retire")}
                >
                  <b>Retire Cell</b>
                  <small>Take the cell out of service. This run isn’t failed; later uses shift or drop off.</small>
                </button>
              </div>
              {errorText && <Note tone="bad" icon="!">{errorText}</Note>}
              <ModalActions>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              </ModalActions>
            </>
          )}
        </>
      )}

      {cell && phase === "disposition" && preview && (
        <>
          <p className={styles.intro}>
            Decide what happens to each affected sample. Lost samples go to the top-up list; Repeatable and Recoverable
            go back to the backlog above High priority.
          </p>
          {required.length > 0 && (
            <>
              <div className={styles.groupTitle}>Needs a decision</div>
              <div className={styles.dispList}>{required.map((a) => renderRow(a, REQUIRED_OPTIONS))}</div>
            </>
          )}
          {flagged.length > 0 && (
            <>
              <div className={styles.groupTitle}>Ran on a different cell — review</div>
              <div className={styles.dispList}>{flagged.map((a) => renderRow(a, FLAGGED_OPTIONS))}</div>
            </>
          )}
          {errorText && <Note tone="bad" icon="!">{errorText}</Note>}
          <ModalActions>
            <Button variant="ghost" onClick={() => setPhase("choose")} disabled={busy}>Back</Button>
            <Button
              variant="primary"
              onClick={() => verdict && commitMutation.mutate({ v: verdict, picks: choices })}
              disabled={busy}
            >
              {commitMutation.isPending ? "Applying…" : "Apply"}
            </Button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}

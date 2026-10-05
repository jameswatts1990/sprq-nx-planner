import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiError } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { PacbioCaseDetailsIn, PacbioCaseOut } from "@/types/pacbioCase";

import styles from "./QcPage.module.css";

/** Today as YYYY-MM-DD in the user's own timezone (the date input's value format). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface PacbioCaseModalProps {
  /** Edit this case's details; omit to log a new case. */
  existing?: PacbioCaseOut;
  onClose: () => void;
  onSaved: (saved: PacbioCaseOut) => void;
}

/** Log a PacBio credit case WITHOUT a cell, or edit one's details. Opens with a warning Note on
 * create so it's unmistakable the case won't be linked to a cell (and what that means). Only the
 * summary and date are required; the rest feeds the generated email/report and the expected
 * reimbursement a cell's case would otherwise work out itself. Edit sends the full detail set
 * (a full replace), so clearing a field really clears it. The case number and note are create-
 * only here - afterwards they're edited through the case's own stage actions. */
export function PacbioCaseModal({ existing, onClose, onSaved }: PacbioCaseModalProps) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? todayIso());
  const [instrumentId, setInstrumentId] = useState(existing?.instrument_id?.toString() ?? "");
  const [runName, setRunName] = useState(existing?.run_name ?? "");
  const [poolId, setPoolId] = useState(existing?.pool_id ?? "");
  const [expected, setExpected] = useState(existing?.expected_acquisitions?.toString() ?? "");
  const [caseNumber, setCaseNumber] = useState("");
  const [notes, setNotes] = useState("");

  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
  });

  const expectedValid = expected === "" || (Number.isInteger(Number(expected)) && Number(expected) >= 1);
  const canSave = summary.trim() !== "" && occurredOn !== "" && expectedValid;

  const mutation = useMutation({
    mutationFn: () => {
      const details: PacbioCaseDetailsIn = {
        summary: summary.trim(),
        occurred_on: occurredOn,
        instrument_id: instrumentId ? Number(instrumentId) : null,
        run_name: runName.trim() || null,
        pool_id: poolId.trim() || null,
        expected_acquisitions: expected ? Number(expected) : null,
      };
      if (existing) return pacbioCasesApi.update(existing.id, details);
      return pacbioCasesApi.create({
        ...details,
        pacbio_case_number: caseNumber.trim() || null,
        credit_notes: notes.trim() || null,
      });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["pacbio-cases"] });
      onSaved(saved);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSave) mutation.mutate();
  }

  return (
    <Modal
      onClose={mutation.isPending ? () => {} : onClose}
      title={existing ? "Edit case details" : "Add case without a cell"}
      maxWidth={600}
    >
      {!existing && (
        <Note tone="warn" icon="!">
          <b>This case won&apos;t be linked to a cell.</b> It won&apos;t change any cell, sample or the schedule, and
          RunNx can&apos;t work out the expected reimbursement for you — enter what you&apos;ll claim below. If the
          failure was on a cell RunNx tracks, cancel and use <b>Cell QC</b> on that cell instead: its case then appears
          here automatically.
        </Note>
      )}
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pc-summary">
            What happened
          </label>
          <input
            id="pc-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Tray damaged on arrival, or a cell failed on a run RunNx didn't schedule"
            maxLength={200}
            autoFocus
          />
        </div>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-date">
              Date it happened
            </label>
            <input
              id="pc-date"
              type="date"
              value={occurredOn}
              max={todayIso()}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-instrument">
              Instrument (optional)
            </label>
            <select id="pc-instrument" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              <option value="">— None —</option>
              {(instruments ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name ? `${i.name} (${i.serial_number})` : i.serial_number}
                  {i.active ? "" : " — retired"}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-run">
              Run (optional)
            </label>
            <input
              id="pc-run"
              type="text"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="e.g. TRACTION-RUN-1234"
              maxLength={120}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-pool">
              Sample / Pool ID (optional)
            </label>
            <input
              id="pc-pool"
              type="text"
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
              placeholder="e.g. TRAC-2-1234"
              maxLength={120}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-expected">
              Acquisitions to claim (optional)
            </label>
            <input
              id="pc-expected"
              type="number"
              min={1}
              step={1}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="e.g. 2"
            />
          </div>
          {!existing && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pc-case-number">
                PacBio case number (optional)
              </label>
              <input
                id="pc-case-number"
                type="text"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="Already raised? e.g. CS-000123"
                maxLength={64}
              />
            </div>
          )}
        </div>
        {!existing && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pc-notes">
              Case notes (optional)
            </label>
            <textarea id="pc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        )}
        <p className={styles.helper}>
          The run, sample, instrument and acquisitions fill the <b>Generate email…</b> and <b>Generate report</b>{" "}
          helpers. The acquisitions PacBio actually credit are recorded later, at the Credit confirmed step.
        </p>

        {!expectedValid && (
          <Note tone="bad" icon="!">
            Acquisitions to claim must be a whole number of 1 or more.
          </Note>
        )}
        {mutation.isError && (
          <Note tone="bad" icon="!">
            {mutation.error instanceof ApiError ? mutation.error.message : "Failed to save the case."}
          </Note>
        )}
        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Add case"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

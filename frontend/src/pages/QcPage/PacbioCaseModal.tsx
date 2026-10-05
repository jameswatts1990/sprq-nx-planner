import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ApiError } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { invalidateCreditCases } from "@/lib/invalidateCreditCases";
import type { PacbioCaseDetailsIn, PacbioCaseOut } from "@/types/pacbioCase";
import { readRememberedOwner, rememberOwner } from "@/utils/rememberedOwner";

import styles from "./QcPage.module.css";

/** Today as YYYY-MM-DD in the user's own timezone (the date input's value format). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const isWholeAtLeastOne = (v: string) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 1);

export interface PacbioCaseModalProps {
  /** Edit this case's details; omit to log a new case. */
  existing?: PacbioCaseOut;
  onClose: () => void;
  onSaved: (saved: PacbioCaseOut) => void;
}

/** Log a PacBio credit case WITHOUT a cell, or edit one's details. Opens with a warning Note on
 * create so it's unmistakable the case won't be linked to a cell (and what that means). Only the
 * summary and date are required; the rest feeds the generated email/report and the expected
 * reimbursement a cell's case would otherwise work out itself.
 *
 * Create also takes the owner and an "Already progressed?" group - every stage the lab already
 * has (case number, internal report ID, acquisitions credited, received) - so backfilling an old
 * case is one step instead of clicking through each stage afterwards. Edit sends the full detail
 * set (a full replace, so clearing a field really clears it); owner and stage values are
 * corrected from the case's own "Recorded" line instead. */
export function PacbioCaseModal({ existing, onClose, onSaved }: PacbioCaseModalProps) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? todayIso());
  const [instrumentId, setInstrumentId] = useState(existing?.instrument_id?.toString() ?? "");
  const [runName, setRunName] = useState(existing?.run_name ?? "");
  const [poolId, setPoolId] = useState(existing?.pool_id ?? "");
  const [expected, setExpected] = useState(existing?.expected_acquisitions?.toString() ?? "");
  const [owner, setOwner] = useState(() => (existing ? "" : readRememberedOwner()));
  const [caseNumber, setCaseNumber] = useState("");
  const [reportId, setReportId] = useState("");
  const [credited, setCredited] = useState("");
  const [received, setReceived] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
  });

  // A credit can only be confirmed / received against a case raised with PacBio - the same rule
  // the backend enforces, caught here so the form says why instead of failing on save.
  const needsCaseNumber = (credited !== "" || received) && caseNumber.trim() === "";
  const problem = !isWholeAtLeastOne(expected)
    ? "Acquisitions to claim must be a whole number of 1 or more."
    : !isWholeAtLeastOne(credited)
      ? "Acquisitions credited must be a whole number of 1 or more."
      : needsCaseNumber
        ? "Enter the PacBio case number - a credit can only be confirmed or received for a case raised with PacBio."
        : null;
  const canSave = summary.trim() !== "" && occurredOn !== "" && problem === null;

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
        internal_report_id: reportId.trim() || null,
        credit_acquisitions: credited ? Number(credited) : null,
        credit_received: received,
        credit_owner: owner.trim() || null,
        credit_notes: notes.trim() || null,
      });
    },
    onSuccess: (saved) => {
      rememberOwner(saved.credit_owner);
      invalidateCreditCases(queryClient);
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
      maxWidth={640}
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
              <label className={styles.fieldLabel} htmlFor="pc-owner">
                Owner (optional)
              </label>
              <input
                id="pc-owner"
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Sanger ID or name, e.g. jw24"
                maxLength={120}
              />
            </div>
          )}
        </div>

        {!existing && (
          <fieldset className={styles.progressed}>
            <legend className={styles.fieldLabel}>Already progressed? (optional)</legend>
            <p className={styles.helper}>
              Fill in any step you&apos;ve already done and the case starts there — no need to click each one through
              afterwards.
            </p>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pc-case-number">
                  PacBio case number
                </label>
                <input
                  id="pc-case-number"
                  type="text"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  placeholder="e.g. 00316913"
                  maxLength={64}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pc-report-id">
                  Internal report ID
                </label>
                <input
                  id="pc-report-id"
                  type="text"
                  value={reportId}
                  onChange={(e) => setReportId(e.target.value)}
                  placeholder="e.g. 26_NC_S_004"
                  maxLength={64}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pc-credited">
                  Acquisitions credited
                </label>
                <input
                  id="pc-credited"
                  type="number"
                  min={1}
                  step={1}
                  value={credited}
                  onChange={(e) => setCredited(e.target.value)}
                  placeholder={expected ? `e.g. ${expected}` : "PacBio confirmed, e.g. 3"}
                />
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />
                Credit already received in lab
              </label>
            </div>
          </fieldset>
        )}

        {/* Right under the fields it's about, so it's in view when Add case greys out. */}
        {problem && (
          <div className={styles.formProblem}>
            <Note tone="bad" icon="!">
              {problem}
            </Note>
          </div>
        )}

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
          helpers; the owner fills the report&apos;s <b>Reported by</b>.
        </p>

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

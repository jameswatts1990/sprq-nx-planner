import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";

import { errorMessage } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { CaseNumberWarning } from "@/components/shared/DuplicateWarnings";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { invalidateCreditCases } from "@/lib/invalidateCreditCases";
import type { CellType } from "@/types/common";
import type { PacbioCaseDetailsIn, PacbioCaseOut } from "@/types/pacbioCase";
import { DEFAULT_CELL_TYPE } from "@/utils/cellType";
import { QC_REVIEW_BADGE } from "@/utils/creditCase";
import { getOperatorName } from "@/utils/operatorName";

import styles from "./QcPage.module.css";

/** PacBio credits acquisitions, and a cell's type sets how many make a cell - so the case says which. */
const CELL_TYPE_OPTIONS: SegmentedOption<CellType>[] = [
  { value: "sprq_nx", label: "SPRQ-Nx", hint: "3 acquisitions / cell", title: "Multi-use SPRQ-Nx cell" },
  { value: "sprq", label: "SPRQ", hint: "1 acquisition / cell", title: "Single-use SPRQ cell" },
];

/** Today as YYYY-MM-DD in the user's own timezone (the date input's value format). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const isWholeAtLeastOne = (v: string) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 1);

/** A new case pre-filled from a QC Review well (MLWH) that has no RunNx cell to fail. */
export interface PacbioCasePrefill {
  /** The well's "<run>|<plate>|<well>" key - saved on the case, which takes it out of the queue. */
  mlwhWellKey: string;
  /** One line naming the well, for the modal's intro. */
  context: string;
  summary: string;
  occurredOn: string;
  /** Matched to a RunNx instrument by serial once the list loads. */
  instrumentSerial: string | null;
  runName: string;
  poolId: string;
  cellType: CellType;
  expectedAcquisitions: number | null;
}

export interface PacbioCaseModalProps {
  /** Edit this case's details; omit to log a new case. */
  existing?: PacbioCaseOut;
  /** Log a new case from a QC Review well (ignored when editing). */
  prefill?: PacbioCasePrefill;
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
export function PacbioCaseModal({ existing, prefill: prefillProp, onClose, onSaved }: PacbioCaseModalProps) {
  const queryClient = useQueryClient();
  const prefill = existing ? undefined : prefillProp;
  const [summary, setSummary] = useState(existing?.summary ?? prefill?.summary ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? prefill?.occurredOn ?? todayIso());
  const [instrumentId, setInstrumentId] = useState(existing?.instrument_id?.toString() ?? "");
  const [runName, setRunName] = useState(existing?.run_name ?? prefill?.runName ?? "");
  const [poolId, setPoolId] = useState(existing?.pool_id ?? prefill?.poolId ?? "");
  const [cellType, setCellType] = useState<CellType>(existing?.cell_type ?? prefill?.cellType ?? DEFAULT_CELL_TYPE);
  const [expected, setExpected] = useState(
    existing?.expected_acquisitions?.toString() ?? prefill?.expectedAcquisitions?.toString() ?? "",
  );
  const [owner, setOwner] = useState(() => (existing ? "" : getOperatorName()));
  const [caseNumber, setCaseNumber] = useState("");
  const [reportId, setReportId] = useState("");
  const [credited, setCredited] = useState("");
  const [received, setReceived] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: instruments } = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
  });

  // A QC Review well names its instrument by serial; pick the matching RunNx instrument once.
  const prefillSerial = prefill?.instrumentSerial ?? null;
  useEffect(() => {
    if (!prefillSerial || !instruments) return;
    const found = instruments.find((i) => i.serial_number.trim().toUpperCase() === prefillSerial.trim().toUpperCase());
    if (found) setInstrumentId((current) => current || String(found.id));
  }, [prefillSerial, instruments]);

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
        cell_type: cellType,
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
        mlwh_well_key: prefill?.mlwhWellKey ?? null,
      });
    },
    onSuccess: (saved) => {
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
      title={existing ? "Edit case details" : prefill ? "Log QC Review case" : "Add case without a cell"}
      maxWidth={640}
    >
      {prefill && (
        <Note tone="info" icon="i">
          <b>QC Review:</b> {prefill.context}. RunNx has no cell to fail for this well, so it&apos;s logged as a case
          without a cell, labelled <b>{QC_REVIEW_BADGE.label}</b>. The details below came from MLWH — check them
          before adding. Deleting the case later puts the well back in QC Review.
        </Note>
      )}
      {!existing && !prefill && (
        <Note tone="warn" icon="!">
          <b>This case won&apos;t be linked to a cell.</b> It won&apos;t change any cell, sample or the schedule, and
          RunNx can&apos;t work out the expected reimbursement for you — enter what you&apos;ll claim below. If the
          failure was on a cell RunNx tracks, cancel and use <b>Cell QC</b> on that cell instead: its case then appears
          here automatically.
        </Note>
      )}
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label className="fieldLabel" htmlFor="pc-summary">
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
            <label className="fieldLabel" htmlFor="pc-date">
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
            <label className="fieldLabel" htmlFor="pc-instrument">
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
            <label className="fieldLabel" htmlFor="pc-run">
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
            <label className="fieldLabel" htmlFor="pc-pool">
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
            <span className="fieldLabel">Cell type</span>
            <SegmentedControl
              options={CELL_TYPE_OPTIONS}
              value={cellType}
              onChange={setCellType}
              ariaLabel="Cell type"
              fullWidth
            />
          </div>
          <div className={styles.field}>
            <label className="fieldLabel" htmlFor="pc-expected">
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
              <label className="fieldLabel" htmlFor="pc-owner">
                Owner (optional)
              </label>
              <input
                id="pc-owner"
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Sanger ID or name, e.g. ab12"
                maxLength={120}
              />
            </div>
          )}
        </div>

        {!existing && (
          <fieldset className={styles.progressed}>
            <legend className="fieldLabel">Already progressed? (optional)</legend>
            <p className={styles.helper}>
              Fill in any step you&apos;ve already done and the case starts there — no need to click each one through
              afterwards.
            </p>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label className="fieldLabel" htmlFor="pc-case-number">
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
                <CaseNumberWarning number={caseNumber} />
              </div>
              <div className={styles.field}>
                <label className="fieldLabel" htmlFor="pc-report-id">
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
                <label className="fieldLabel" htmlFor="pc-credited">
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
            <label className="fieldLabel" htmlFor="pc-notes">
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
            {errorMessage(mutation.error, "Couldn't save the case.")}
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

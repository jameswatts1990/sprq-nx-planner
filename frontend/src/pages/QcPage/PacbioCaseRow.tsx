import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { pacbioCasesApi } from "@/api/pacbioCases";
import { CellTypeBadge } from "@/components/cells/CellTypeBadge";
import { PacbioCaseActions } from "@/components/cells/CreditCaseActions";
import { PacbioCreditTracker } from "@/components/cells/PacbioCreditTracker";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateCreditCases } from "@/lib/invalidateCreditCases";
import type { PacbioCaseOut } from "@/types/pacbioCase";
import { formatDateTime, formatDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { type CreditCaseAge, NO_CELL_BADGE } from "@/utils/creditCase";

import { PacbioCaseModal } from "./PacbioCaseModal";
import { CaseRowFrame, type RowExpansion } from "./QcCaseRow";
import styles from "./QcPage.module.css";

/** The typed-in details of a no-cell case, shown above its stage actions when expanded, with
 * Edit / Delete - a hand-logged case has no Cell QC undo, so these are how a mistake is fixed. */
function CaseDetails({ pacbioCase }: { pacbioCase: PacbioCaseOut }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => pacbioCasesApi.del(pacbioCase.id),
    onSuccess: () => invalidateCreditCases(queryClient),
  });

  const rows: [string, string | null][] = [
    ["What happened", pacbioCase.summary],
    ["Date", formatDateUTC(parseDateOnly(pacbioCase.occurred_on))],
    ["Instrument", pacbioCase.instrument_serial],
    ["Run", pacbioCase.run_name],
    ["Sample / Pool ID", pacbioCase.pool_id],
    ["Cell type", pacbioCase.cell_type === "sprq" ? "SPRQ (single use)" : "SPRQ-Nx"],
    ["Acquisitions to claim", pacbioCase.expected_acquisitions?.toString() ?? null],
  ];

  return (
    <div className={styles.caseDetails}>
      <Note tone="warn" icon="!">
        Not linked to a cell — logged on {formatDateTime(pacbioCase.created_at)}
        {/* No auth yet, so the actor is usually the "unknown" placeholder - only name a real one. */}
        {pacbioCase.created_by && pacbioCase.created_by !== "unknown" ? ` by ${pacbioCase.created_by}` : ""}. Edit
        the details if anything was entered wrong.
      </Note>
      <dl className={styles.detailList}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.detailItem}>
            <dt className="detailLabel">{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.detailActions}>
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          Edit details
        </Button>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete case
        </Button>
      </div>

      {editOpen && (
        <PacbioCaseModal existing={pacbioCase} onClose={() => setEditOpen(false)} onSaved={() => setEditOpen(false)} />
      )}
      {deleteOpen && (
        <ConfirmModal
          title="Delete this case?"
          confirmLabel="Delete case"
          confirmVariant="danger"
          pendingLabel="Deleting…"
          pending={del.isPending}
          error={del.isError ? errorMessage(del.error, "Couldn't delete the case.") : undefined}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => del.mutate()}
        >
          <Note tone="warn" icon="!">
            “{pacbioCase.summary}” will be removed from the QC page and the Stats credit figures, including any credit
            recorded against it. Only use this for a case logged by mistake — the audit log keeps a copy, but the app
            can&apos;t restore it.
          </Note>
        </ConfirmModal>
      )}
    </div>
  );
}

/** A credit case logged without a cell, in the QC worklist: its summary stands where a cell's
 * code would, flagged No cell link, with the typed-in run/sample as context. */
export function PacbioCaseRow({
  pacbioCase,
  age,
  ...expansion
}: { pacbioCase: PacbioCaseOut; age: CreditCaseAge | null } & RowExpansion) {
  return (
    <CaseRowFrame
      {...expansion}
      credit={pacbioCase}
      expected={pacbioCase.expected_acquisitions}
      age={age}
      date={formatDateUTC(parseDateOnly(pacbioCase.occurred_on))}
      head={
        <>
          <span className={styles.summary}>{pacbioCase.summary}</span>
          <Badge tone={NO_CELL_BADGE.tone} title="Logged by hand on the QC page - not linked to any cell in RunNx">
            {NO_CELL_BADGE.label}
          </Badge>
          <CellTypeBadge cellType={pacbioCase.cell_type} />
          {pacbioCase.instrument_serial && <span className={styles.metaText}>{pacbioCase.instrument_serial}</span>}
        </>
      }
      ctx={
        pacbioCase.run_name || pacbioCase.pool_id ? (
          <>
            {pacbioCase.run_name && (
              <>
                <span className={styles.ctxLabel}>Run</span>
                <span>{pacbioCase.run_name}</span>
              </>
            )}
            {pacbioCase.pool_id && (
              <>
                <span className={styles.ctxLabel}>Sample</span>
                <span>{pacbioCase.pool_id}</span>
              </>
            )}
          </>
        ) : (
          <span className={styles.muted}>No run or sample recorded.</span>
        )
      }
      action={<PacbioCaseActions pacbioCase={pacbioCase} compact />}
      renderDetail={() => (
        <PacbioCreditTracker
          credit={pacbioCase}
          failureAt={pacbioCase.occurred_on}
          failureDateOnly
          actions={<PacbioCaseActions pacbioCase={pacbioCase} />}
        >
          <CaseDetails pacbioCase={pacbioCase} />
        </PacbioCreditTracker>
      )}
    />
  );
}

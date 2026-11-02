import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";

import styles from "./CellsPage.module.css";

// Every multi-use SMRT Cell physically supports up to 3 acquisitions - not a per-cell choice.
const CELL_MAX_USES = 3;

function splitBarcodes(text: string): string[] {
  return [...new Set(text.split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export interface RegisterInProgressCellModalProps {
  onClose: () => void;
  onRegistered: () => void;
}

/**
 * One-off cutover action for registering cells that were physically already in
 * progress on an instrument before this system went live - not a routine workflow,
 * hence the explicit "go-live only" helper text and the separate bootstrap endpoint.
 */
export function RegisterInProgressCellModal({ onClose, onRegistered }: RegisterInProgressCellModalProps) {
  const [usesConsumed, setUsesConsumed] = useState(1);
  const [barcodesText, setBarcodesText] = useState("");
  const [firstUseStartedAt, setFirstUseStartedAt] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      cellsApi.bootstrap({
        uses_consumed: usesConsumed,
        burned_barcodes: splitBarcodes(barcodesText),
        first_use_started_at: firstUseStartedAt ? new Date(firstUseStartedAt).toISOString() : null,
      }),
    onSuccess: () => onRegistered(),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const barcodes = splitBarcodes(barcodesText);

  return (
    <Modal onClose={onClose} title="Register in-progress cell">
      <p className={styles.helper}>
        For cells already on an instrument before go-live only - not a routine workflow.
      </p>
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className="fieldLabel">Uses already consumed (of {CELL_MAX_USES})</label>
          <input
            type="number"
            min={0}
            max={CELL_MAX_USES - 1}
            value={usesConsumed}
            onChange={(e) => setUsesConsumed(Math.max(0, Math.min(CELL_MAX_USES - 1, Number(e.target.value))))}
          />
        </div>
        <div className={styles.field}>
          <label className="fieldLabel">Burned barcodes</label>
          <textarea
            value={barcodesText}
            onChange={(e) => setBarcodesText(e.target.value)}
            placeholder="e.g. bc2021 bc2044"
          />
        </div>
        <div className={styles.field}>
          <label className="fieldLabel">First use started at (optional)</label>
          <input
            type="datetime-local"
            value={firstUseStartedAt}
            onChange={(e) => setFirstUseStartedAt(e.target.value)}
          />
        </div>

        {mutation.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(mutation.error, "Couldn't register the cell.")}
          </Note>
        )}

        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending || barcodes.length === 0}>
            {mutation.isPending ? "Registering…" : "Register cell"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

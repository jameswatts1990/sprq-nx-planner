import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { instrumentsApi } from "@/api/instruments";
import { CellStatusCard } from "@/components/cells/CellStatusCard";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { CellStatus } from "@/types/common";
import type { MaxUses } from "@/types/schedule";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./CellsPage.module.css";

type StatusFilter = CellStatus | "all";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "exhausted", label: "Exhausted" },
  { value: "window_expired", label: "Window expired" },
  { value: "retired", label: "Retired" },
];

function splitBarcodes(text: string): string[] {
  return [...new Set(text.split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export function CellsPage() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [instrumentSerial, setInstrumentSerial] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput, 350);
  const [modalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const query = useQuery({
    queryKey: ["cells", { status, instrumentSerial, q }],
    queryFn: () =>
      cellsApi.list({
        status: status === "all" ? undefined : status,
        instrument_serial: instrumentSerial || undefined,
        q: q || undefined,
        page_size: 100,
      }),
  });

  const cells = query.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={styles.chip}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className={styles.select}
          value={instrumentSerial}
          onChange={(e) => setInstrumentSerial(e.target.value)}
        >
          <option value="">All instruments</option>
          {(instrumentsQuery.data ?? []).map((i) => (
            <option key={i.id} value={i.serial_number}>
              {i.serial_number}
            </option>
          ))}
        </select>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by cell code or barcode…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <div className={styles.spacer} />
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          Register in-progress cell
        </Button>
      </div>

      {query.isLoading && <div className={styles.status}>Loading cells…</div>}
      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load cells."}
        </Note>
      )}
      {!query.isLoading && !query.isError && cells.length === 0 && (
        <div className={styles.status}>No cells match this filter.</div>
      )}
      {cells.length > 0 && (
        <div className={styles.grid}>
          {cells.map((cell) => (
            <CellStatusCard key={cell.id} cell={cell} />
          ))}
        </div>
      )}

      {modalOpen && (
        <RegisterInProgressCellModal
          onClose={() => setModalOpen(false)}
          onRegistered={() => {
            setModalOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["cells"] });
          }}
        />
      )}
    </div>
  );
}

interface RegisterInProgressCellModalProps {
  onClose: () => void;
  onRegistered: () => void;
}

const BOOTSTRAP_MAX_USES_OPTIONS = [
  { value: 1 as MaxUses, label: "1×" },
  { value: 2 as MaxUses, label: "2×" },
  { value: 3 as MaxUses, label: "3×" },
];

/**
 * One-off cutover action for registering cells that were physically already in
 * progress on an instrument before this system went live - not a routine workflow,
 * hence the explicit "go-live only" helper text and the separate bootstrap endpoint.
 */
function RegisterInProgressCellModal({ onClose, onRegistered }: RegisterInProgressCellModalProps) {
  const [maxUses, setMaxUses] = useState<MaxUses>(3);
  const [usesConsumed, setUsesConsumed] = useState(1);
  const [barcodesText, setBarcodesText] = useState("");
  const [firstUseStartedAt, setFirstUseStartedAt] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      cellsApi.bootstrap({
        max_uses: maxUses,
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

  function handleMaxUsesChange(v: MaxUses) {
    setMaxUses(v);
    setUsesConsumed((prev) => Math.min(prev, v - 1));
  }

  const barcodes = splitBarcodes(barcodesText);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Register in-progress cell</h2>
        <p className={styles.helper}>
          For cells already on an instrument before go-live only - not a routine workflow.
        </p>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Max uses</label>
            <SegmentedControl
              ariaLabel="Max uses"
              options={BOOTSTRAP_MAX_USES_OPTIONS}
              value={maxUses}
              onChange={handleMaxUsesChange}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Uses already consumed</label>
            <input
              type="number"
              min={0}
              max={maxUses - 1}
              value={usesConsumed}
              onChange={(e) => setUsesConsumed(Math.max(0, Math.min(maxUses - 1, Number(e.target.value))))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Burned barcodes</label>
            <textarea
              value={barcodesText}
              onChange={(e) => setBarcodesText(e.target.value)}
              placeholder="e.g. bc2021 bc2044"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>First use started at (optional)</label>
            <input
              type="datetime-local"
              value={firstUseStartedAt}
              onChange={(e) => setFirstUseStartedAt(e.target.value)}
            />
          </div>

          {mutation.isError && (
            <Note tone="bad" icon="!">
              {mutation.error instanceof ApiError ? mutation.error.message : "Failed to register cell."}
            </Note>
          )}

          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={mutation.isPending || barcodes.length === 0}>
              {mutation.isPending ? "Registering…" : "Register cell"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

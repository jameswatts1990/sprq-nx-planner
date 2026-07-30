import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { cellsApi } from "@/api/cells";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import type { CellOut } from "@/types/cell";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { useDebouncedValue } from "@/utils/useDebouncedValue";

import styles from "./CellChoicePicker.module.css";

export interface CellChoicePickerProps {
  instrumentSerial: string;
  /** The tray this plate is already committed to, if any (see
   * placement_service._established_tray_id) - its open siblings are listed first under
   * "Suggested", since that's overwhelmingly the correct pick and the backend will reject
   * anything else once a plate already holds a tray. */
  suggestedTrayId?: number | null;
  onSelect: (cellId: number) => void;
  onClose: () => void;
  pending?: boolean;
}

/**
 * The manual "force a specific cell" override: a searchable list of every open cell on this
 * instrument, calling back with a chosen cell id so the caller can place/move with
 * `cell_choice: {mode:"existing", cell_id}` - the one explicit escape hatch from the
 * reuse-before-new auto-derivation, for when an operator needs to correct or override it by
 * hand (e.g. forcing Plate 2 onto Plate 1's exact cells). Safe to expose broadly: the backend
 * still enforces that a plate can never end up split across two physical trays, so this can
 * guide a correct fix but can't be used to recreate that bug.
 */
export function CellChoicePicker({
  instrumentSerial,
  suggestedTrayId,
  onSelect,
  onClose,
  pending,
}: CellChoicePickerProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const cellsQuery = useQuery({
    queryKey: ["cells", "choice-picker", instrumentSerial, debouncedSearch],
    queryFn: () =>
      cellsApi.list({
        instrument_serial: instrumentSerial,
        status: "open",
        q: debouncedSearch || undefined,
        page_size: 50,
      }),
  });

  const cells = cellsQuery.data?.items ?? [];
  const suggested = suggestedTrayId != null ? cells.filter((c) => c.tray_id === suggestedTrayId) : [];
  const suggestedIds = new Set(suggested.map((c) => c.id));
  const rest = cells.filter((c) => !suggestedIds.has(c.id));

  function row(cell: CellOut) {
    return (
      <button key={cell.id} type="button" className={styles.row} onClick={() => onSelect(cell.id)} disabled={pending}>
        <span className={styles.code}>{cell.code}</span>
        <Badge tone={CELL_STATUS_TONE[cell.status]}>{CELL_STATUS_LABEL[cell.status]}</Badge>
        <span className={styles.meta}>
          {cell.tray_id != null ? `Tray ${cell.tray_id}` : "no tray"} · {cell.uses_consumed}/{cell.max_uses} used
        </span>
      </button>
    );
  }

  return (
    <Modal onClose={onClose} title="Choose a specific cell">
      <input
        type="text"
        className={styles.search}
        placeholder="Search by cell code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className={styles.list}>
        {cellsQuery.isLoading && <div className={styles.empty}>Loading…</div>}
        {!cellsQuery.isLoading && cells.length === 0 && (
          <div className={styles.empty}>No open cells found on {instrumentSerial}.</div>
        )}
        {suggested.length > 0 && (
          <>
            <div className={styles.groupLabel}>Suggested — this plate&apos;s own tray</div>
            {suggested.map(row)}
            {rest.length > 0 && <div className={styles.groupLabel}>Other open cells</div>}
          </>
        )}
        {rest.map(row)}
      </div>
      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </ModalActions>
    </Modal>
  );
}

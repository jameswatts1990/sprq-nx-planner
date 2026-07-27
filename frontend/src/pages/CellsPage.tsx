import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cellsApi } from "@/api/cells";
import { instrumentsApi } from "@/api/instruments";
import { CellStatusCard } from "@/components/cells/CellStatusCard";
import { OpenTraysAccordion } from "@/components/cells/OpenTraysAccordion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { CellOut } from "@/types/cell";
import type { CellStatus } from "@/types/common";
import {
  CELL_GROUP_OPTIONS,
  CELL_SORT_OPTIONS,
  type CellGroupKey,
  type CellSortKey,
  groupCells,
  type SortDir,
  sortCells,
} from "@/utils/cellOrdering";
import { CELL_STATUS_LABEL, CELL_STATUS_TONE } from "@/utils/cellStatus";
import { soonestTrayExpiry } from "@/utils/openTrays";
import { useDebouncedValue } from "@/utils/useDebouncedValue";
import { FADE_MIN_HOURS } from "@/utils/windowFade";

import styles from "./CellsPage.module.css";

type QcFilter = "unreported" | "awaiting_credit";
type StatusFilter = CellStatus | "all" | QcFilter;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "exhausted", label: "Exhausted" },
  { value: "window_expired", label: "Window expired" },
  { value: "retired", label: "Retired" },
  { value: "stopped", label: "Stopped" },
  { value: "unreported", label: "Unreported" },
  { value: "awaiting_credit", label: "Awaiting credit" },
];

function isQcFilter(value: StatusFilter): value is QcFilter {
  return value === "unreported" || value === "awaiting_credit";
}

const VALID_STATUS_FILTERS = new Set<string>(STATUS_FILTERS.map((f) => f.value));

/** A status filter from the URL (?status=...), if it's a recognised one - lets the schedule
 * grid's tray-map link land here pre-filtered (e.g. ?instrument=84047&status=all). */
function statusFromParam(raw: string | null): StatusFilter | null {
  return raw && VALID_STATUS_FILTERS.has(raw) ? (raw as StatusFilter) : null;
}

function splitBarcodes(text: string): string[] {
  return [...new Set(text.split(/[,;/\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export function CellsPage() {
  // Seed the filters from the URL once on mount, so a link like
  // /cells?instrument=84047&status=all (the schedule grid's tray-map header) lands here
  // already filtered to that instrument. Left as plain local state thereafter.
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() => statusFromParam(searchParams.get("status")) ?? "open");
  const [instrumentSerial, setInstrumentSerial] = useState(() => searchParams.get("instrument") ?? "");
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput, 350);
  const [modalOpen, setModalOpen] = useState(false);
  // Order + grouping are pure view state over the fetched page - default is grouped by
  // tray (a physical tray's four cells read together, in position order) sorted by cell code.
  const [sortBy, setSortBy] = useState<CellSortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [groupBy, setGroupBy] = useState<CellGroupKey>("tray");
  const queryClient = useQueryClient();

  // When the sort key changes, seed the direction from that key's natural default (newest-
  // first for dates, A→Z for names, etc.) - the toggle can still flip it afterwards.
  function changeSort(next: CellSortKey) {
    setSortBy(next);
    setSortDir(CELL_SORT_OPTIONS.find((o) => o.value === next)?.defaultDir ?? "asc");
  }

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const query = useQuery({
    queryKey: ["cells", { status, instrumentSerial, q }],
    queryFn: () =>
      cellsApi.list({
        status: status === "all" || isQcFilter(status) ? undefined : status,
        qc_status: isQcFilter(status) ? status : undefined,
        instrument_serial: instrumentSerial || undefined,
        q: q || undefined,
        page_size: 100,
      }),
  });

  const cells = query.data?.items ?? [];

  // Order + group the fetched page for display. useMemo so a keystroke elsewhere doesn't
  // re-sort/re-group every render - only when the cells or the view controls change.
  const groups = useMemo(
    () => groupCells(sortCells(cells, sortBy, sortDir), groupBy),
    [cells, sortBy, sortDir, groupBy],
  );

  return (
    <div className={styles.page}>
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search cells, trays, container IDs, runs, barcodes, instruments…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          Register in-progress cell
        </Button>
      </div>

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
        <div className={styles.spacer} />
        <select
          className={styles.select}
          value={instrumentSerial}
          onChange={(e) => setInstrumentSerial(e.target.value)}
          aria-label="Filter by instrument"
        >
          <option value="">All instruments</option>
          {(instrumentsQuery.data ?? []).map((i) => (
            <option key={i.id} value={i.serial_number}>
              {i.name ? `${i.name} (${i.serial_number})` : i.serial_number}
            </option>
          ))}
        </select>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Sort</span>
          <select
            className={styles.select}
            value={sortBy}
            onChange={(e) => changeSort(e.target.value as CellSortKey)}
          >
            {CELL_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.dirToggle}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
            aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
          >
            {sortDir === "asc" ? "▲" : "▼"}
          </button>
        </label>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Group</span>
          <select
            className={styles.select}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as CellGroupKey)}
          >
            {CELL_GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.trayAccordionWrap}>
        <OpenTraysAccordion />
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
      {cells.length > 0 &&
        (groupBy === "none" ? (
          <div className={styles.grid}>
            {groups[0]?.cells.map((cell) => (
              <CellStatusCard key={cell.id} cell={cell} />
            ))}
          </div>
        ) : (
          <div className={styles.groups}>
            {groups.map((g) => (
              <section key={g.id} className={styles.group}>
                <GroupHeader groupBy={groupBy} cells={g.cells} />
                <div className={styles.grid}>
                  {g.cells.map((cell) => (
                    <CellStatusCard key={cell.id} cell={cell} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}

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

interface GroupHeaderProps {
  groupBy: CellGroupKey;
  cells: CellOut[];
}

function expiryText(hours: number): string {
  return hours <= 1 ? "<1h left" : `${Math.ceil(hours)}h left`;
}

/** Section header for a group of cells - what it shows depends on how the list is grouped.
 * A tray header links straight to that tray's page and surfaces its instrument and soonest
 * window expiry; an instrument header links to that instrument's cells; a status header
 * shows the same badge the cards use. Every header carries the group's cell count. */
function GroupHeader({ groupBy, cells }: GroupHeaderProps) {
  const count = cells.length;
  const countLabel = `${count} cell${count === 1 ? "" : "s"}`;

  if (groupBy === "tray") {
    const trayId = cells[0]?.tray_id ?? null;
    const instrument = cells.find((c) => c.current_instrument_serial)?.current_instrument_serial ?? null;
    const soonest = soonestTrayExpiry(cells);
    const urgent = soonest !== null && soonest <= FADE_MIN_HOURS;
    return (
      <div className={styles.groupHeader}>
        {trayId !== null ? (
          <Link to={`/trays/${trayId}`} className={styles.groupTitle}>
            Tray {trayId}
          </Link>
        ) : (
          <span className={styles.groupTitle}>No tray</span>
        )}
        {instrument && <span className={styles.groupMeta}>· {instrument}</span>}
        <span className={styles.groupCount}>{countLabel}</span>
        {soonest !== null && (
          <span className={urgent ? styles.groupExpiryUrgent : styles.groupExpiry}>{expiryText(soonest)}</span>
        )}
      </div>
    );
  }

  if (groupBy === "instrument") {
    const serial = cells[0]?.current_instrument_serial ?? null;
    return (
      <div className={styles.groupHeader}>
        {serial ? (
          <Link to={`/cells?instrument=${encodeURIComponent(serial)}&status=all`} className={styles.groupTitle}>
            {serial}
          </Link>
        ) : (
          <span className={styles.groupTitle}>No instrument</span>
        )}
        <span className={styles.groupCount}>{countLabel}</span>
      </div>
    );
  }

  // status
  const st = cells[0]?.status;
  return (
    <div className={styles.groupHeader}>
      {st && (
        <span className={styles.groupTitle}>
          <Badge tone={CELL_STATUS_TONE[st]}>{CELL_STATUS_LABEL[st]}</Badge>
        </span>
      )}
      <span className={styles.groupCount}>{countLabel}</span>
    </div>
  );
}

interface RegisterInProgressCellModalProps {
  onClose: () => void;
  onRegistered: () => void;
}

// Every multi-use SMRT Cell physically supports up to 3 acquisitions - not a per-cell choice.
const CELL_MAX_USES = 3;

/**
 * One-off cutover action for registering cells that were physically already in
 * progress on an instrument before this system went live - not a routine workflow,
 * hence the explicit "go-live only" helper text and the separate bootstrap endpoint.
 */
function RegisterInProgressCellModal({ onClose, onRegistered }: RegisterInProgressCellModalProps) {
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
          <label className={styles.fieldLabel}>Uses already consumed (of {CELL_MAX_USES})</label>
          <input
            type="number"
            min={0}
            max={CELL_MAX_USES - 1}
            value={usesConsumed}
            onChange={(e) => setUsesConsumed(Math.max(0, Math.min(CELL_MAX_USES - 1, Number(e.target.value))))}
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

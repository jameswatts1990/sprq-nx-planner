import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { instrumentsApi } from "@/api/instruments";
import { RevioScreen } from "@/components/scheduler/RevioScreen";
import { RunStageGantt } from "@/components/scheduler/RunStageGantt";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { InstrumentOut, InstrumentStatsOut } from "@/types/instrument";
import type { RunOut } from "@/types/schedule";
import { formatShortDateTimeUTC, formatShortDateUTC, parseDateOnly } from "@/utils/calendarDates";
import { INSTRUMENT_STATUS_LABEL, INSTRUMENT_STATUS_TONE, instrumentStatus } from "@/utils/instrumentStatus";

import styles from "./InstrumentsPage.module.css";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  return formatShortDateUTC(parseDateOnly(iso));
}

export function InstrumentsPage() {
  const queryClient = useQueryClient();

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", false],
    queryFn: () => instrumentsApi.list(false),
  });
  const statsQuery = useQuery({
    queryKey: ["instrument-stats"],
    queryFn: () => instrumentsApi.stats(),
  });

  // Active-run gantts on each card. A run in progress loaded at most ~a couple of days ago
  // (load → next-day reuse plate → up to a 30h movie + PPA tail), so a short load-date window
  // around now is enough to fetch the candidates; is_locked then narrows to the runs whose
  // window actually contains "now". One query for every card, grouped by serial below.
  const runsWindow = useMemo(() => {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 4);
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, []);
  const activeRunsQuery = useQuery({
    // Keyed under ["cycles", …] so invalidateScheduleRelated refreshes it; a slow refetch keeps
    // the set honest as runs start/finish (the gantt's own live line ticks independently).
    queryKey: ["cycles", "active", runsWindow.from, runsWindow.to],
    queryFn: () => cyclesApi.list({ date_from: runsWindow.from, date_to: runsWindow.to }),
    refetchInterval: 60_000,
  });
  const activeRunsBySerial = useMemo(() => {
    const map = new Map<string, RunOut[]>();
    for (const run of activeRunsQuery.data ?? []) {
      if (!run.is_locked) continue; // in-progress only (excludes planned/aborted/completed)
      const list = map.get(run.instrument_serial) ?? [];
      list.push(run);
      map.set(run.instrument_serial, list);
    }
    return map;
  }, [activeRunsQuery.data]);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<InstrumentOut | null>(null);
  const [downing, setDowning] = useState<InstrumentOut | null>(null);
  const [confirming, setConfirming] = useState<{ instrument: InstrumentOut; kind: ConfirmKind } | null>(null);

  // One shared post-mutation refresh: the schedule grid's instrument axis + this page's list
  // and stats. invalidateScheduleRelated already covers ["instruments"] (so the grid regreys/
  // re-rows); ["instrument-stats"] is this page's own key.
  function refresh() {
    invalidateScheduleRelated(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["instrument-stats"] });
  }

  const statsById = new Map<number, InstrumentStatsOut>((statsQuery.data ?? []).map((s) => [s.id, s]));
  const instruments = instrumentsQuery.data ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Instruments</h1>
        <div className={styles.spacer} />
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          Add instrument
        </Button>
      </div>
      <p className={styles.intro}>
        The Revio/SPRQ-Nx instruments runs are scheduled onto. Add or rename them, mark one down for maintenance
        (it stays visible in the Schedule but greys out from the down date and takes no new runs until it&apos;s back
        online), or remove one that was added by mistake.
      </p>

      {instrumentsQuery.isLoading && <div className={styles.status}>Loading instruments…</div>}
      {instrumentsQuery.isError && (
        <Note tone="bad" icon="!">
          {errorMessage(instrumentsQuery.error, "Failed to load instruments.")}
        </Note>
      )}
      {!instrumentsQuery.isLoading && !instrumentsQuery.isError && instruments.length === 0 && (
        <div className={styles.status}>No instruments yet — add your first Revio.</div>
      )}

      {instruments.length > 0 && (
        <div className={styles.grid}>
          {instruments.map((instrument) => (
            <InstrumentCard
              key={instrument.id}
              instrument={instrument}
              stats={statsById.get(instrument.id)}
              activeRuns={activeRunsBySerial.get(instrument.serial_number) ?? []}
              activeRunsUpdatedAt={activeRunsQuery.dataUpdatedAt}
              onEdit={() => setEditing(instrument)}
              onDown={() => setDowning(instrument)}
              onConfirm={(kind) => setConfirming({ instrument, kind })}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddInstrumentModal
          onClose={() => setAddOpen(false)}
          onDone={() => {
            refresh();
            setAddOpen(false);
          }}
        />
      )}
      {editing && (
        <EditInstrumentModal
          instrument={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
      {downing && (
        <MaintenanceModal
          instrument={downing}
          onClose={() => setDowning(null)}
          onDone={() => {
            refresh();
            setDowning(null);
          }}
        />
      )}
      {confirming && (
        <ConfirmActionModal
          instrument={confirming.instrument}
          kind={confirming.kind}
          onClose={() => setConfirming(null)}
          onDone={() => {
            refresh();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

// --- status ---------------------------------------------------------------

function statusBadge(instrument: InstrumentOut): ReactNode {
  const status = instrumentStatus(instrument);
  return <Badge tone={INSTRUMENT_STATUS_TONE[status]}>{INSTRUMENT_STATUS_LABEL[status]}</Badge>;
}

/** A plain-language summary of what the instrument is doing right now, from the live per-cell
 * counts (cell_timing.instrument_activity). "" when nothing is loaded/active. */
function liveStateLabel(s: InstrumentStatsOut): string {
  const parts: string[] = [];
  if (s.cells_sequencing) parts.push(`${s.cells_sequencing} sequencing`);
  if (s.cells_in_ppa) parts.push(`${s.cells_in_ppa} in PPA`);
  if (s.cells_prepping) parts.push(`${s.cells_prepping} prepping`);
  if (s.cells_awaiting_prep) parts.push(`${s.cells_awaiting_prep} awaiting prep`);
  return parts.join(" · ");
}

// --- card -----------------------------------------------------------------

interface InstrumentCardProps {
  instrument: InstrumentOut;
  stats: InstrumentStatsOut | undefined;
  /** Runs in progress on this instrument right now — rendered as one shared live gantt. */
  activeRuns: RunOut[];
  /** When activeRuns was last fetched (dataUpdatedAt) — the baseline the Revio screen's live
   * 108h "Use within" countdown ticks down from. */
  activeRunsUpdatedAt: number;
  onEdit: () => void;
  onDown: () => void;
  onConfirm: (kind: ConfirmKind) => void;
}

function InstrumentCard({ instrument, stats, activeRuns, activeRunsUpdatedAt, onEdit, onDown, onConfirm }: InstrumentCardProps) {
  const hasHistory = !!stats && (stats.total_runs > 0 || stats.cell_total_count > 0);

  return (
    <Card className={instrument.active ? undefined : styles.inactive}>
      <CardHeader badge={statusBadge(instrument)}>
        <div className={styles.nameWrap}>
          <span className={styles.name}>{instrument.name || instrument.serial_number}</span>
          {instrument.name && <span className={styles.serial}>{instrument.serial_number}</span>}
        </div>
      </CardHeader>
      <CardBody>
        {instrument.down_from && (
          <div className={styles.downNote}>
            <Note tone="warn" icon="⚠">
              Down for maintenance since {shortDate(instrument.down_from)}
              {instrument.down_note ? ` — ${instrument.down_note}` : ""}. No new runs can be scheduled on it from
              that date until it&apos;s back online.
            </Note>
          </div>
        )}

        {activeRuns.length > 0 && (
          <RevioScreen
            serial={instrument.serial_number}
            runs={activeRuns}
            dataUpdatedAt={activeRunsUpdatedAt}
          />
        )}

        <StatTiles>
          <StatTile
            label="Currently running"
            value={stats?.running_run_name ?? "—"}
            hint={stats?.free_at ? `frees ${formatShortDateTimeUTC(stats.free_at)}` : stats?.running_run_name ? undefined : "idle"}
          />
          <StatTile
            label="Open trays"
            value={
              stats && stats.open_tray_count > 0 ? (
                <Link className={styles.statLink} to={`/cells?instrument=${instrument.serial_number}&status=open`}>
                  {stats.open_tray_count}
                </Link>
              ) : (
                (stats?.open_tray_count ?? 0)
              )
            }
          />
          <StatTile
            label="Cells (open)"
            value={stats?.cell_open_count ?? 0}
            hint={stats ? `of ${stats.cell_total_count} on instrument` : undefined}
          />
          <StatTile
            label="Total runs"
            value={stats?.total_runs ?? 0}
            hint={stats?.last_run_date ? `last ${shortDate(stats.last_run_date)}` : "none yet"}
          />
          <StatTile label="Next run" value={stats?.next_run_date ? shortDate(stats.next_run_date) : "—"} />
        </StatTiles>

        {stats && liveStateLabel(stats) && (
          <div className={styles.liveState}>
            <span className={styles.liveDot} aria-hidden="true" />
            <span className={styles.liveText}>{liveStateLabel(stats)}</span>
            {stats.prep_locked && (
              <span className={styles.liveLock} title="A fresh tray can't be loaded until every cell has broken out">
                prep-locked
              </span>
            )}
          </div>
        )}

        {activeRuns.length > 0 && (
          <div className={styles.gantt}>
            <div className={styles.ganttHeading}>
              {activeRuns.length > 1 ? `${activeRuns.length} runs in progress` : "Run in progress"}
            </div>
            <RunStageGantt runs={activeRuns} />
          </div>
        )}

        <div className={styles.actions}>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {instrument.down_from ? (
            <Button size="sm" variant="ghost" onClick={() => onConfirm("online")}>
              Bring online
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onDown}>
              Mark down
            </Button>
          )}
          {instrument.active ? (
            <Button size="sm" variant="ghost" onClick={() => onConfirm("retire")}>
              Retire
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onConfirm("reactivate")}>
              Reactivate
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            disabled={hasHistory}
            title={hasHistory ? "This instrument has run history — retire it instead of deleting." : undefined}
            onClick={() => onConfirm("delete")}
          >
            Delete
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// --- add / edit modals ----------------------------------------------------

function AddInstrumentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [serial, setSerial] = useState("");
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: () => instrumentsApi.create({ serial_number: serial.trim(), name: name.trim() || null }),
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Modal onClose={onClose} title="Add instrument">
      <p className={styles.helper}>The serial number is the Revio&apos;s own identity (e.g. 84047) and can&apos;t be changed later. The name is an optional friendly label shown in the Schedule.</p>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Serial number</label>
          <input type="text" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="e.g. 84047" />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Name (optional)</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Revio A" />
        </div>
        {mutation.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(mutation.error, "Failed to add instrument.")}
          </Note>
        )}
        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending || serial.trim() === ""}>
            {mutation.isPending ? "Adding…" : "Add instrument"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function EditInstrumentModal({
  instrument,
  onClose,
  onDone,
}: {
  instrument: InstrumentOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(instrument.name ?? "");

  const mutation = useMutation({
    // Always send the (trimmed) string, never null - the backend's PATCH ignores null fields
    // ("don't touch"), so sending "" is what lets a name be cleared back to the serial.
    mutationFn: () => instrumentsApi.update(instrument.id, { name: name.trim() }),
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Modal onClose={onClose} title={`Edit ${instrument.serial_number}`}>
      <p className={styles.helper}>The name is the friendly label shown in the Schedule. Leave it blank to show the serial instead.</p>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Revio A" />
        </div>
        {mutation.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(mutation.error, "Failed to save.")}
          </Note>
        )}
        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function MaintenanceModal({
  instrument,
  onClose,
  onDone,
}: {
  instrument: InstrumentOut;
  onClose: () => void;
  onDone: () => void;
}) {
  const [downFrom, setDownFrom] = useState(todayIso());
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => instrumentsApi.markDown(instrument.id, { down_from: downFrom, note: note.trim() || null }),
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Modal onClose={onClose} title={`Mark ${instrument.name || instrument.serial_number} down`}>
      <p className={styles.helper}>
        From this date the instrument greys out in the Schedule and takes no new runs, until you bring it back
        online. Runs already scheduled before the date are unaffected.
      </p>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Down from</label>
          <input type="date" value={downFrom} onChange={(e) => setDownFrom(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Reason (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. laser replacement" />
        </div>
        {mutation.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(mutation.error, "Failed to update.")}
          </Note>
        )}
        <ModalActions>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending || downFrom === ""}>
            {mutation.isPending ? "Saving…" : "Mark down"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

// --- confirm actions (online / retire / reactivate / delete) --------------

type ConfirmKind = "online" | "retire" | "reactivate" | "delete";

const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: (i: InstrumentOut) => string; body: ReactNode; confirmLabel: string; pendingLabel: string }
> = {
  online: {
    title: (i) => `Bring ${i.name || i.serial_number} back online?`,
    body: <p>It will accept new runs again and stop being greyed out in the Schedule.</p>,
    confirmLabel: "Bring online",
    pendingLabel: "Updating…",
  },
  retire: {
    title: (i) => `Retire ${i.name || i.serial_number}?`,
    body: (
      <p>
        It will be hidden from the Schedule and the instrument dropdowns, but its run history is kept. You can
        reactivate it any time.
      </p>
    ),
    confirmLabel: "Retire",
    pendingLabel: "Retiring…",
  },
  reactivate: {
    title: (i) => `Reactivate ${i.name || i.serial_number}?`,
    body: <p>It will reappear in the Schedule and instrument dropdowns and can take runs again.</p>,
    confirmLabel: "Reactivate",
    pendingLabel: "Reactivating…",
  },
  delete: {
    title: (i) => `Delete ${i.name || i.serial_number}?`,
    body: <p>This permanently removes the instrument. Only possible while it has no run or tray history.</p>,
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
  },
};

function ConfirmActionModal({
  instrument,
  kind,
  onClose,
  onDone,
}: {
  instrument: InstrumentOut;
  kind: ConfirmKind;
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = CONFIRM_COPY[kind];

  const mutation = useMutation({
    mutationFn: async () => {
      switch (kind) {
        case "online":
          await instrumentsApi.markOnline(instrument.id);
          return;
        case "retire":
          await instrumentsApi.update(instrument.id, { active: false });
          return;
        case "reactivate":
          await instrumentsApi.update(instrument.id, { active: true });
          return;
        case "delete":
          await instrumentsApi.del(instrument.id);
          return;
      }
    },
    onSuccess: onDone,
  });

  return (
    <ConfirmModal
      title={copy.title(instrument)}
      confirmLabel={copy.confirmLabel}
      pendingLabel={copy.pendingLabel}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error, "Action failed.") : null}
      onCancel={onClose}
      onConfirm={() => mutation.mutate()}
    >
      {copy.body}
    </ConfirmModal>
  );
}

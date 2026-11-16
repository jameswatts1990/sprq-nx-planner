import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { AffectedRunOut, DowntimeIn, DowntimeKind, DowntimeOut, InstrumentOut } from "@/types/instrument";
import { formatShortDateUTC, parseDateOnly, shortWeekdayUTC, todayIsoUTC } from "@/utils/calendarDates";
import { DOWNTIME_KIND_LABEL, formatDowntimeSpan } from "@/utils/downtime";
import { runLabel } from "@/utils/runLabel";

import styles from "./InstrumentsPage.module.css";

const KIND_OPTIONS = [
  { value: "unplanned" as const, label: "Unplanned", title: "A breakdown or fault — it wasn't booked in advance" },
  { value: "planned" as const, label: "Planned", title: "A booked service visit, upgrade or preventive maintenance" },
];

const EMPTY_FORM: DowntimeIn = { start_date: "", end_date: null, kind: "unplanned", note: null };

function dayLabel(iso: string): string {
  return `${shortWeekdayUTC(parseDateOnly(iso))} ${formatShortDateUTC(parseDateOnly(iso))}`;
}

/** The instrument's downtime periods: list (current/upcoming, then past), add, edit, end and
 * delete. Saving shows the runs already booked inside the period - listed, never moved. Every
 * change is audited (Activity). The live `instrument` comes from the page's query, so the list
 * refreshes after each save via onChanged. */
export function InstrumentDowntimeModal({
  instrument,
  onClose,
  onChanged,
}: {
  instrument: InstrumentOut;
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = todayIsoUTC();
  const label = instrument.name || instrument.serial_number;
  const [editing, setEditing] = useState<DowntimeOut | null>(null);
  const [form, setForm] = useState<DowntimeIn>({ ...EMPTY_FORM, start_date: today });
  const [affected, setAffected] = useState<AffectedRunOut[] | null>(null);
  const [deleting, setDeleting] = useState<DowntimeOut | null>(null);

  const ahead = instrument.downtimes.filter((p) => p.end_date === null || p.end_date >= today);
  const past = instrument.downtimes.filter((p) => p.end_date !== null && p.end_date < today).reverse();

  function resetForm() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, start_date: today });
  }

  const save = useMutation({
    mutationFn: () => {
      const req = { ...form, note: form.note?.trim() || null };
      return editing
        ? instrumentsApi.updateDowntime(instrument.id, editing.id, req)
        : instrumentsApi.addDowntime(instrument.id, req);
    },
    onSuccess: (out) => {
      setAffected(out.affected_runs);
      resetForm();
      onChanged();
    },
  });
  const end = useMutation({
    mutationFn: (period: DowntimeOut) => instrumentsApi.endDowntime(instrument.id, period.id),
    onSuccess: () => {
      setAffected(null);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (period: DowntimeOut) => instrumentsApi.deleteDowntime(instrument.id, period.id),
    onSuccess: () => {
      setDeleting(null);
      setAffected(null);
      if (editing && deleting && editing.id === deleting.id) resetForm();
      onChanged();
    },
  });

  function startEdit(period: DowntimeOut) {
    save.reset();
    setAffected(null);
    setEditing(period);
    setForm({ start_date: period.start_date, end_date: period.end_date, kind: period.kind, note: period.note });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const datesBackwards = form.end_date !== null && form.end_date !== "" && form.end_date < form.start_date;

  function row(period: DowntimeOut) {
    // End = "back online today": offered while the period is under way (a future one is deleted instead).
    const underway = period.start_date <= today;
    return (
      <li key={period.id} className={styles.downtimeRow}>
        <div className={styles.downtimeWhat}>
          <Badge tone={period.kind === "planned" ? "info" : "orange"}>{DOWNTIME_KIND_LABEL[period.kind]}</Badge>
          <span className={styles.downtimeSpan}>
            {period.end_date === null ? `${formatDowntimeSpan(period)} · until brought back online` : formatDowntimeSpan(period)}
          </span>
          {period.note && <span className={styles.downtimeNote}>{period.note}</span>}
        </div>
        <div className={styles.downtimeActions}>
          <Button size="sm" variant="ghost" onClick={() => startEdit(period)}>
            Edit
          </Button>
          {underway && (period.end_date === null || period.end_date >= today) && (
            <Button
              size="sm"
              variant="ghost"
              title="Back online from today: its last down day becomes yesterday"
              disabled={end.isPending}
              onClick={() => end.mutate(period)}
            >
              End today
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDeleting(period)}>
            Delete
          </Button>
        </div>
      </li>
    );
  }

  return (
    <>
      <Modal onClose={onClose} title={`Downtime — ${label}`} maxWidth={620}>
        <p className={styles.helper}>
          On a down day no new run can load: the Schedule greys the day and Autoschedule skips it. Runs already booked
          inside a period are listed when you save it, never moved.
        </p>

        {ahead.length > 0 ? (
          <ul className={styles.downtimeList} aria-label="Current and upcoming downtime">
            {ahead.map(row)}
          </ul>
        ) : (
          <p className={styles.downtimeEmpty}>No current or upcoming downtime.</p>
        )}
        {past.length > 0 && (
          <details className={styles.downtimePast}>
            <summary>Past ({past.length})</summary>
            <ul className={styles.downtimeList}>{past.map(row)}</ul>
          </details>
        )}
        {end.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(end.error, "Couldn't end the downtime.")}
          </Note>
        )}

        {affected && affected.length > 0 && (
          <div className={styles.downtimeAffected}>
            <Note tone="warn" icon="!">
              {affected.length === 1 ? "1 run is" : `${affected.length} runs are`} already booked on down days and{" "}
              {affected.length === 1 ? "wasn't" : "weren't"} moved — reschedule {affected.length === 1 ? "it" : "them"}, or
              change the dates if the instrument will be available:
              <ul>
                {affected.map((r) => (
                  <li key={r.run_id}>
                    <Link to={`/schedule?from=${r.load_date}`}>
                      Run {runLabel(r)} — loads {dayLabel(r.load_date)}
                    </Link>
                    {r.plates.length === 1 && r.plates[0] === 2 ? " (its Plate 2 acquires on a down day)" : ""}
                    {r.status === "running" ? " · already loaded" : ""}
                  </li>
                ))}
              </ul>
            </Note>
          </div>
        )}
        {affected && affected.length === 0 && (
          <div className={styles.downtimeAffected}>
            <Note tone="good" icon="✓">
              Saved. No runs are booked on those days.
            </Note>
          </div>
        )}

        <form onSubmit={submit} className={styles.downtimeForm}>
          <div className={styles.downtimeFormTitle}>{editing ? "Edit downtime" : "Add downtime"}</div>
          <div className={styles.downtimeDates}>
            <div className={styles.field}>
              <label className="fieldLabel" htmlFor="downtime-start">
                First down day
              </label>
              <input
                id="downtime-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className="fieldLabel" htmlFor="downtime-end">
                Last down day
              </label>
              <input
                id="downtime-end"
                type="date"
                value={form.end_date ?? ""}
                min={form.start_date || undefined}
                onChange={(e) => setForm({ ...form, end_date: e.target.value || null })}
              />
            </div>
          </div>
          <p className={styles.fieldHint}>
            {form.end_date ? "Both days count as down." : "No last day: down until you end it (Bring online)."}
          </p>
          <div className={styles.field}>
            <span className="fieldLabel">Kind</span>
            <SegmentedControl<DowntimeKind>
              options={KIND_OPTIONS}
              value={form.kind}
              onChange={(kind) => setForm({ ...form, kind })}
              ariaLabel="Downtime kind"
            />
          </div>
          <div className={styles.field}>
            <label className="fieldLabel" htmlFor="downtime-note">
              Reason (optional)
            </label>
            <textarea
              id="downtime-note"
              value={form.note ?? ""}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="e.g. laser replacement — engineer on site"
            />
          </div>
          {datesBackwards && (
            <Note tone="bad" icon="!">
              The last down day can&apos;t be before the first.
            </Note>
          )}
          {save.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(save.error, "Couldn't save the downtime.")}
            </Note>
          )}
          <ModalActions>
            {editing ? (
              <Button variant="ghost" type="button" onClick={resetForm}>
                Cancel edit
              </Button>
            ) : (
              <Button variant="ghost" type="button" onClick={onClose}>
                Close
              </Button>
            )}
            <Button
              variant="primary"
              type="submit"
              disabled={save.isPending || form.start_date === "" || datesBackwards}
            >
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Add downtime"}
            </Button>
          </ModalActions>
        </form>
      </Modal>

      {deleting && (
        <ConfirmModal
          title="Delete this downtime?"
          confirmLabel="Delete"
          confirmVariant="danger"
          pendingLabel="Deleting…"
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error, "Couldn't delete the downtime.") : null}
          onCancel={() => {
            remove.reset();
            setDeleting(null);
          }}
          onConfirm={() => remove.mutate(deleting)}
        >
          <p>
            {DOWNTIME_KIND_LABEL[deleting.kind]} · {formatDowntimeSpan(deleting)}
            {deleting.note ? ` — ${deleting.note}` : ""}. Its days open up for new runs again, and it no longer counts
            in Stats&apos; instrument availability. To record that the instrument came back early, use{" "}
            <b>End today</b> instead.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { InstrumentOut } from "@/types/instrument";
import { todayIsoUTC } from "@/utils/calendarDates";

import styles from "./PrintBatchSheetModal.module.css";

export interface PrintBatchSheetModalProps {
  /** Active instruments, already loaded by the Schedule page - avoids a second fetch. */
  instruments: InstrumentOut[];
  onClose: () => void;
}

/** Lets the user pick a day and which Revios to include, then opens the printable
 * batch sheet (/print/batch-sheet) in a new tab. Generation itself is just a plain
 * page + the browser's native print-to-PDF - see BatchSheetPage. */
export function PrintBatchSheetModal({ instruments, onClose }: PrintBatchSheetModalProps) {
  const [date, setDate] = useState(todayIsoUTC());
  // Explicit per-serial overrides layered on top of the "checked if scheduled" default;
  // cleared whenever the date changes so each day starts from a fresh default.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const cyclesQuery = useQuery({
    queryKey: ["cycles", { date_from: date, date_to: date }],
    queryFn: () => cyclesApi.list({ date_from: date, date_to: date }),
  });

  const scheduledSerials = new Set((cyclesQuery.data ?? []).map((c) => c.instrument_serial));

  function isChecked(serial: string): boolean {
    return overrides[serial] ?? scheduledSerials.has(serial);
  }

  function toggle(serial: string) {
    setOverrides((prev) => ({ ...prev, [serial]: !isChecked(serial) }));
  }

  function onDateChange(newDate: string) {
    setDate(newDate);
    setOverrides({});
  }

  const selectedSerials = instruments
    .filter((i) => scheduledSerials.has(i.serial_number) && isChecked(i.serial_number))
    .map((i) => i.serial_number);

  function onViewSheet() {
    const qs = new URLSearchParams({ date, instruments: selectedSerials.join(",") });
    window.open(`/print/batch-sheet?${qs.toString()}`, "_blank", "noopener,noreferrer");
    onClose();
  }

  const loaded = !cyclesQuery.isLoading && !cyclesQuery.isError;
  const noneScheduled = loaded && scheduledSerials.size === 0;

  return (
    <Modal onClose={onClose} title="Print Batch Sheet">
      <div className={styles.field}>
        <label className={styles.label} htmlFor="batch-sheet-date">
          Day
        </label>
        <input
          id="batch-sheet-date"
          className={styles.dateInput}
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      {cyclesQuery.isLoading && <div className={styles.label}>Loading runs…</div>}
      {cyclesQuery.isError && (
        <Note tone="bad" icon="!">
          {cyclesQuery.error instanceof ApiError ? cyclesQuery.error.message : "Failed to load runs for this day."}
        </Note>
      )}
      {noneScheduled && (
        <Note tone="info" icon="i">
          No runs scheduled on this day.
        </Note>
      )}

      {loaded && !noneScheduled && (
        <fieldset className={styles.choices}>
          <legend className={styles.label}>Revios to include</legend>
          {instruments.map((i) => {
            const scheduled = scheduledSerials.has(i.serial_number);
            return (
              <label key={i.serial_number} className={styles.choice} data-disabled={!scheduled}>
                <input
                  type="checkbox"
                  checked={isChecked(i.serial_number)}
                  disabled={!scheduled}
                  onChange={() => toggle(i.serial_number)}
                />
                <span className={styles.choiceMain}>
                  {i.name || i.serial_number}
                  {i.name && <span className={styles.meta}>{i.serial_number}</span>}
                </span>
                {!scheduled && <span className={styles.meta}>no run scheduled</span>}
              </label>
            );
          })}
        </fieldset>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onViewSheet} disabled={selectedSerials.length === 0}>
          View Sheet
        </Button>
      </ModalActions>
    </Modal>
  );
}

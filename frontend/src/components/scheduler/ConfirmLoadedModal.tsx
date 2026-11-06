import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { clampLoadHour, fmtHour, LoadTimeDial } from "@/components/scheduler/LoadTimeDial";
import { formatLoadTime, parseLoadTime } from "@/components/scheduler/loadTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import { localWallTimeToUtcParts } from "@/utils/calendarDates";
import { getOperatorName, setOperatorName } from "@/utils/operatorName";

import styles from "./ConfirmLoadedModal.module.css";

export interface ConfirmLoadedModalProps {
  runId: number;
  /** The run's load day (YYYY-MM-DD) - the typed time is on this day's local wall clock. */
  loadDate: string;
  /** "Revio <name or serial>", for the title. */
  instrumentLabel: string;
  /** The run's current Traction run name, to edit. */
  runName: string | null;
  /** Batch Sheet pre-flight items still unticked - listed as a reminder, never a block. */
  uncheckedPreflight?: string[];
  onClose: () => void;
}

/** The one "Confirm loaded" dialog, opened from the schedule grid and from the Batch Sheet: locks
 * the whole run (status -> running) with who loaded it (prefilled from the navbar's operator name,
 * sent as the audit actor), an optional Traction run name and the real load time. The time starts
 * at now - pressing the button IS the load - and the dial sets a whole hour in one click. */
export function ConfirmLoadedModal({
  runId,
  loadDate,
  instrumentLabel,
  runName: initialRunName,
  uncheckedPreflight = [],
  onClose,
}: ConfirmLoadedModalProps) {
  const queryClient = useQueryClient();
  const [loadedBy, setLoadedBy] = useState(getOperatorName);
  const [runName, setRunName] = useState(initialRunName ?? "");
  const [loadTime, setLoadTime] = useState(() => formatLoadTime(new Date()));
  // The hour under the pointer while it's over the dial; otherwise the dial follows the field.
  const [hoverHour, setHoverHour] = useState<number | null>(null);

  const parsed = parseLoadTime(loadTime);
  const timeValid = parsed !== null;
  const nameValid = loadedBy.trim().length > 0;

  const mutation = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error("Enter a valid load time.");
      // Typed on the lab's local wall clock; the backend stores UTC (see localWallTimeToUtcParts).
      const utc = localWallTimeToUtcParts(loadDate, parsed.hour, parsed.minute);
      return cyclesApi.updateStatus(runId, {
        status: "running",
        actor: loadedBy.trim(),
        run_name: runName,
        start_hour: utc.hour,
        start_minute: utc.minute,
      });
    },
    onSuccess: () => {
      // A browser with no name yet adopts the loader's, so the navbar chip and every later change
      // are signed with it too. An existing name is left alone (a colleague loading at your desk).
      if (!getOperatorName()) setOperatorName(loadedBy);
      // Loading anchors each cell's 108h clock, so the tray panel and cells change too.
      invalidateScheduleRelated(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["batch-sheet"] });
      onClose();
    },
  });

  return (
    <ConfirmModal
      title={`Confirm ${instrumentLabel} loaded?`}
      confirmLabel="Confirm loaded"
      pendingLabel="Confirming…"
      pending={mutation.isPending}
      confirmDisabled={!timeValid || !nameValid}
      error={mutation.isError ? errorMessage(mutation.error, "Couldn't mark the run as loaded.") : null}
      onCancel={onClose}
      onConfirm={() => mutation.mutate()}
    >
      <p className={styles.intro}>
        This locks the whole run — both plates — so it can no longer be edited by accident, and starts its cells&apos;
        108-hour clocks from the time below.
      </p>
      {uncheckedPreflight.length > 0 && (
        <Note tone="warn" icon="!">
          Pre-flight checklist not finished: {uncheckedPreflight.join(", ")}.
        </Note>
      )}
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="confirm-loaded-by">
          Your name
        </label>
        <input
          id="confirm-loaded-by"
          type="text"
          className={styles.input}
          value={loadedBy}
          onChange={(e) => setLoadedBy(e.target.value)}
          placeholder="Who loaded the Revio"
          autoFocus={!loadedBy}
        />
      </div>
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="confirm-run-name">
          Traction run name (optional)
        </label>
        <input
          id="confirm-run-name"
          type="text"
          className={styles.input}
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          placeholder="e.g. TRACTION-RUN-1234"
          autoFocus={!!loadedBy}
        />
      </div>
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="confirm-load-time">
          Revio loaded at
        </label>
        <input
          id="confirm-load-time"
          type="text"
          inputMode="numeric"
          className={`${styles.input} ${timeValid ? "" : styles.invalid}`}
          value={loadTime}
          onChange={(e) => setLoadTime(e.target.value)}
          placeholder="hh:mm"
          aria-invalid={!timeValid}
        />
        {!timeValid && <span className={styles.hint}>Enter a 24-hour time as hh:mm (e.g. 14:30).</span>}
      </div>
      <LoadTimeDial
        active={hoverHour ?? clampLoadHour(parsed?.hour ?? 12)}
        onActiveChange={setHoverHour}
        onPick={(h) => setLoadTime(fmtHour(h))}
        onMouseLeave={() => setHoverHour(null)}
        centerTime={hoverHour != null ? fmtHour(hoverHour) : timeValid ? loadTime : "--:--"}
        centerSub="loaded"
      />
    </ConfirmModal>
  );
}

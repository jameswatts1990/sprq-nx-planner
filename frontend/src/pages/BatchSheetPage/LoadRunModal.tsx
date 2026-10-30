import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { cyclesApi } from "@/api/cycles";
import { clampLoadHour, fmtHour, LoadTimeDial } from "@/components/scheduler/LoadTimeDial";
import { formatLoadTime, parseLoadTime } from "@/components/scheduler/loadTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Note } from "@/components/ui/Note";
import { invalidateScheduleRelated } from "@/lib/invalidateScheduleRelated";
import type { BatchSheetRunOut } from "@/types/batchSheet";
import { localWallTimeToUtcParts } from "@/utils/calendarDates";

import styles from "./LoadRunModal.module.css";

/** The loader's name, remembered per browser so whoever loads most days types it once. */
const LOADED_BY_STORAGE_KEY = "runnx.batchSheet.loadedBy";

function readLoadedBy(): string {
  try {
    return localStorage.getItem(LOADED_BY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberLoadedBy(name: string) {
  try {
    localStorage.setItem(LOADED_BY_STORAGE_KEY, name);
  } catch {
    // Storage blocked: the name just isn't prefilled next time.
  }
}

/** The Batch Sheet's "Load" action: the same lock as the schedule grid's Confirm loaded
 * (status -> running, optional Traction run name, real load time), plus the loader's name,
 * sent as the audit-log actor. The time defaults to now; the dial sets a whole hour in one
 * click and the text field takes any hh:mm. An unfinished pre-flight checklist is flagged,
 * never blocking - the checklist is a memory aid, not a gate. */
export function LoadRunModal({
  run,
  uncheckedPreflight,
  onClose,
}: {
  run: BatchSheetRunOut;
  uncheckedPreflight: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [loadedBy, setLoadedBy] = useState(readLoadedBy);
  const [runName, setRunName] = useState(run.run_name ?? "");
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
      const utc = localWallTimeToUtcParts(run.load_date, parsed.hour, parsed.minute);
      return cyclesApi.updateStatus(run.run_id, {
        status: "running",
        actor: loadedBy.trim(),
        run_name: runName,
        start_hour: utc.hour,
        start_minute: utc.minute,
      });
    },
    onSuccess: () => {
      rememberLoadedBy(loadedBy.trim());
      invalidateScheduleRelated(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["batch-sheet"] });
      onClose();
    },
  });

  return (
    <ConfirmModal
      title={`Confirm ${run.instrument_name} loaded?`}
      confirmLabel="Confirm loaded"
      pendingLabel="Confirming…"
      pending={mutation.isPending}
      confirmDisabled={!timeValid || !nameValid}
      error={mutation.isError ? errorMessage(mutation.error, "Couldn't mark the run as loaded.") : null}
      onCancel={onClose}
      onConfirm={() => mutation.mutate()}
    >
      <p className={styles.intro}>
        This locks the whole run, both plates, exactly like <b>Confirm loaded</b> on the schedule.
      </p>
      {uncheckedPreflight.length > 0 && (
        <Note tone="warn" icon="!">
          Pre-flight checklist not finished: {uncheckedPreflight.join(", ")}.
        </Note>
      )}
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="load-run-by">
          Your name
        </label>
        <input
          id="load-run-by"
          type="text"
          className={styles.input}
          value={loadedBy}
          onChange={(e) => setLoadedBy(e.target.value)}
          placeholder="Who loaded the Revio"
          autoFocus={!loadedBy}
        />
      </div>
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="load-run-name">
          Traction run name (optional)
        </label>
        <input
          id="load-run-name"
          type="text"
          className={styles.input}
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          placeholder="e.g. TRACTION-RUN-1234"
          autoFocus={!!loadedBy}
        />
      </div>
      <div className={styles.field}>
        <label className="fieldLabel" htmlFor="load-run-time">
          Revio loaded at
        </label>
        <input
          id="load-run-time"
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

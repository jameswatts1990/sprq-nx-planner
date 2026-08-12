import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { SchedulingSettings, SchedulingSettingsUpdate } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import styles from "./SampleDefaultsPanel.module.css";

/** Settings > Scheduling: global scheduling parameters that go through the validated,
 * audit-logged service path (not a raw table edit).
 *  - Insert-size re-use threshold: a library at/below this size (bp) is kept on a cell's first
 *    use by Auto Schedule and flagged if placed manually on a 2nd/3rd use.
 *  - Default run start hour: the hour a run loads by default; pre-fills the Schedule grid's
 *    load-time dial. Movie-length rules live in their own "Movie scheduling" panel.
 *  - Cleaned complex volumes: the total made per sample and the safe leftover threshold for a
 *    repeat straight from complex; drive the Cell QC modal's repeat-from-complex readout. */
export function SchedulingPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["scheduling-settings"], queryFn: () => settingsApi.getScheduling() });

  const [threshold, setThreshold] = useState<string>("");
  const [dayStartHour, setDayStartHour] = useState<string>("");
  const [totalComplex, setTotalComplex] = useState<string>("");
  const [safeMin, setSafeMin] = useState<string>("");
  useEffect(() => {
    if (query.data) {
      setThreshold(String(query.data.insert_size_reuse_threshold_bp));
      setDayStartHour(String(query.data.day_start_hour));
      setTotalComplex(String(query.data.repeat_total_complex_ul));
      setSafeMin(String(query.data.repeat_safe_min_ul));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: SchedulingSettingsUpdate) => settingsApi.updateScheduling(body),
    onSuccess: (data: SchedulingSettings) => {
      setThreshold(String(data.insert_size_reuse_threshold_bp));
      setDayStartHour(String(data.day_start_hour));
      setTotalComplex(String(data.repeat_total_complex_ul));
      setSafeMin(String(data.repeat_safe_min_ul));
      queryClient.setQueryData(["scheduling-settings"], data);
    },
  });

  const parsedThreshold = Number(threshold);
  const thresholdValid = threshold.trim() !== "" && Number.isInteger(parsedThreshold) && parsedThreshold > 0;
  const hour = Number(dayStartHour);
  const hourValid = dayStartHour !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  const parsedTotal = Number(totalComplex);
  const totalValid = totalComplex.trim() !== "" && Number.isFinite(parsedTotal) && parsedTotal > 0;
  const parsedSafe = Number(safeMin);
  const safeValid = safeMin.trim() !== "" && Number.isFinite(parsedSafe) && parsedSafe > 0;
  const valid = thresholdValid && hourValid && totalValid && safeValid;
  // Not an error (the backend stores each independently), but a safe threshold above the total
  // would mean no repeat is ever "safe" — worth flagging.
  const safeExceedsTotal = totalValid && safeValid && parsedSafe > parsedTotal;

  const dirty =
    query.data != null &&
    ((thresholdValid && parsedThreshold !== query.data.insert_size_reuse_threshold_bp) ||
      (hourValid && hour !== query.data.day_start_hour) ||
      (totalValid && parsedTotal !== query.data.repeat_total_complex_ul) ||
      (safeValid && parsedSafe !== query.data.repeat_safe_min_ul));

  const save = () => {
    if (!valid || !query.data) return;
    const body: SchedulingSettingsUpdate = {};
    if (parsedThreshold !== query.data.insert_size_reuse_threshold_bp)
      body.insert_size_reuse_threshold_bp = parsedThreshold;
    if (hour !== query.data.day_start_hour) body.day_start_hour = hour;
    if (parsedTotal !== query.data.repeat_total_complex_ul) body.repeat_total_complex_ul = parsedTotal;
    if (parsedSafe !== query.data.repeat_safe_min_ul) body.repeat_safe_min_ul = parsedSafe;
    mutation.mutate(body);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Scheduling</h2>
        <p className={styles.helper}>
          Global rules Auto Schedule and manual placement follow. Existing schedules are unaffected until re-run.
        </p>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load scheduling settings."}
        </Note>
      )}

      {query.data && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className={styles.fieldLabel}>Insert size re-use threshold (bp)</span>
                  <span className={styles.fieldHint}>
                    Samples at or below this size are kept on a cell’s first use; a “[&lt;5kb]” flag and a warning show
                    if one is placed on a 2nd/3rd use.
                  </span>
                </td>
                <td>
                  <input
                    className={styles.select}
                    type="number"
                    min={1}
                    step={100}
                    inputMode="numeric"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    aria-label="Insert size re-use threshold in base pairs"
                  />
                </td>
              </tr>
              <tr>
                <td>
                  <span className={styles.fieldLabel}>Default run start hour</span>
                  <span className={styles.fieldHint}>
                    The time of day a run loads by default (UTC). Pre-fills the Schedule grid’s load-time dial.
                  </span>
                </td>
                <td>
                  <select
                    className={styles.select}
                    value={dayStartHour}
                    onChange={(e) => setDayStartHour(e.target.value)}
                    aria-label="Default run start hour"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td>
                  <span className={styles.fieldLabel}>Cleaned complex made (µL)</span>
                  <span className={styles.fieldHint}>
                    Total cleaned complex prepared per sample. Cell QC shows how much is left after loading when
                    deciding a repeat from complex.
                  </span>
                </td>
                <td>
                  <input
                    className={styles.select}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    value={totalComplex}
                    onChange={(e) => setTotalComplex(e.target.value)}
                    aria-label="Total cleaned complex made in microlitres"
                  />
                </td>
              </tr>
              <tr>
                <td>
                  <span className={styles.fieldLabel}>Safe repeat-from-complex volume (µL)</span>
                  <span className={styles.fieldHint}>
                    Leftover cleaned complex at or above which Cell QC suggests a repeat straight from complex; below
                    it the repeat is flagged “at risk” (never blocked).
                  </span>
                </td>
                <td>
                  <input
                    className={styles.select}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    value={safeMin}
                    onChange={(e) => setSafeMin(e.target.value)}
                    aria-label="Safe repeat-from-complex volume in microlitres"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {mutation.isError && (
            <Note tone="bad" icon="!">
              {mutation.error instanceof ApiError ? mutation.error.message : "Failed to save scheduling settings."}
            </Note>
          )}
          {!thresholdValid && threshold.trim() !== "" && (
            <Note tone="warn" icon="!">
              Enter a whole number of base pairs greater than 0.
            </Note>
          )}
          {((!totalValid && totalComplex.trim() !== "") || (!safeValid && safeMin.trim() !== "")) && (
            <Note tone="warn" icon="!">
              Enter a volume in microlitres greater than 0.
            </Note>
          )}
          {safeExceedsTotal && (
            <Note tone="warn" icon="!">
              The safe repeat volume is above the total cleaned complex made — no repeat from complex would ever be
              flagged “safe”.
            </Note>
          )}

          <div className={styles.actions}>
            {!dirty && !mutation.isPending && valid && <span className={styles.savedNote}>All changes saved</span>}
            <Button variant="primary" size="sm" disabled={!dirty || !valid || mutation.isPending} onClick={save}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

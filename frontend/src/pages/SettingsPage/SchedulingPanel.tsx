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
 *    load-time dial. Movie-length rules live in their own "Movie scheduling" panel. */
export function SchedulingPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["scheduling-settings"], queryFn: () => settingsApi.getScheduling() });

  const [threshold, setThreshold] = useState<string>("");
  const [dayStartHour, setDayStartHour] = useState<string>("");
  useEffect(() => {
    if (query.data) {
      setThreshold(String(query.data.insert_size_reuse_threshold_bp));
      setDayStartHour(String(query.data.day_start_hour));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: SchedulingSettingsUpdate) => settingsApi.updateScheduling(body),
    onSuccess: (data: SchedulingSettings) => {
      setThreshold(String(data.insert_size_reuse_threshold_bp));
      setDayStartHour(String(data.day_start_hour));
      queryClient.setQueryData(["scheduling-settings"], data);
    },
  });

  const parsedThreshold = Number(threshold);
  const thresholdValid = threshold.trim() !== "" && Number.isInteger(parsedThreshold) && parsedThreshold > 0;
  const hour = Number(dayStartHour);
  const hourValid = dayStartHour !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  const valid = thresholdValid && hourValid;

  const dirty =
    query.data != null &&
    ((thresholdValid && parsedThreshold !== query.data.insert_size_reuse_threshold_bp) ||
      (hourValid && hour !== query.data.day_start_hour));

  const save = () => {
    if (!valid || !query.data) return;
    const body: SchedulingSettingsUpdate = {};
    if (parsedThreshold !== query.data.insert_size_reuse_threshold_bp)
      body.insert_size_reuse_threshold_bp = parsedThreshold;
    if (hour !== query.data.day_start_hour) body.day_start_hour = hour;
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

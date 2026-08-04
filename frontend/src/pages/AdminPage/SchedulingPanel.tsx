import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { SchedulingSettings } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import styles from "./SampleDefaultsPanel.module.css";

/** Admin panel: global scheduling parameters. Currently the insert-size re-use threshold - a
 * library whose insert size is at/below this (bp) is treated as "small": Auto Schedule keeps it
 * on a cell's first use, and it carries a "[<5kb]" flag plus a warning if placed manually on a
 * 2nd/3rd use. Goes through the validated, audit-logged service path (not a raw table edit),
 * like the Sample-defaults panel; read publicly by the card flag/warning. */
export function SchedulingPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["scheduling-settings"], queryFn: () => settingsApi.getScheduling() });

  const [value, setValue] = useState<string>("");
  useEffect(() => {
    if (query.data) setValue(String(query.data.insert_size_reuse_threshold_bp));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: SchedulingSettings) => settingsApi.updateScheduling(body),
    onSuccess: (data) => {
      setValue(String(data.insert_size_reuse_threshold_bp));
      queryClient.setQueryData(["scheduling-settings"], data);
    },
  });

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(parsed) && parsed > 0;
  const dirty = query.data != null && valid && parsed !== query.data.insert_size_reuse_threshold_bp;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Scheduling</h2>
        <p className={styles.helper}>
          Insert-size re-use threshold. A library whose insert size is at or below this many base pairs is treated as
          “small” — Auto Schedule keeps it on a cell’s first use, it carries a “[&lt;5kb]” flag, and a warning shows if
          one is placed manually on a 2nd/3rd use. Existing schedules are unaffected until re-run.
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
                  <span className={styles.fieldHint}>Samples at or below this size are kept on a cell’s first use.</span>
                </td>
                <td>
                  <input
                    className={styles.select}
                    type="number"
                    min={1}
                    step={100}
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    aria-label="Insert size re-use threshold in base pairs"
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
          {!valid && value.trim() !== "" && (
            <Note tone="warn" icon="!">
              Enter a whole number of base pairs greater than 0.
            </Note>
          )}

          <div className={styles.actions}>
            {!dirty && !mutation.isPending && valid && <span className={styles.savedNote}>All changes saved</span>}
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || mutation.isPending}
              onClick={() => valid && mutation.mutate({ insert_size_reuse_threshold_bp: parsed })}
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

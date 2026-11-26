import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { errorMessage } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { QcSettings } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";

import styles from "./SettingsPanel.module.css";

const MAX_OVERDUE_DAYS = 365;
const MAX_LOOKBACK_DAYS = 730;

const isWholeDays = (raw: string, max: number) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= max;
};

/** Settings > QC & credits: the overdue limit for PacBio credit cases - an open case waiting longer
 * than this at its current stage gets the Overdue badge and counts on the QC nav chip - and how far
 * back the QC Review queue reads the QC team's LangQC verdicts from MLWH. */
export function QcSettingsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["qc-settings"], queryFn: () => settingsApi.getQc() });

  const [overdueDays, setOverdueDays] = useState("");
  const [lookbackDays, setLookbackDays] = useState("");
  useEffect(() => {
    if (query.data) {
      setOverdueDays(String(query.data.overdue_days));
      setLookbackDays(String(query.data.review_lookback_days));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: QcSettings) => settingsApi.updateQc(body),
    onSuccess: (data) => {
      setOverdueDays(String(data.overdue_days));
      setLookbackDays(String(data.review_lookback_days));
      queryClient.setQueryData(["qc-settings"], data);
      // The nav count's overdue part is judged against this limit on the server, and the QC Review
      // queue's window against the lookback.
      void queryClient.invalidateQueries({ queryKey: ["qc-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["qc-review"] });
    },
  });

  const overdueValid = isWholeDays(overdueDays, MAX_OVERDUE_DAYS);
  const lookbackValid = isWholeDays(lookbackDays, MAX_LOOKBACK_DAYS);
  const valid = overdueValid && lookbackValid;
  const dirty =
    query.data != null &&
    valid &&
    (Number(overdueDays) !== query.data.overdue_days || Number(lookbackDays) !== query.data.review_lookback_days);

  return (
    <Card>
      <CardHeader>
        <h2>QC &amp; credits</h2>
      </CardHeader>
      <CardBody className={styles.body}>
        <p className={styles.helper}>How the QC &amp; credits tab chases PacBio credit cases.</p>

        {query.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(query.error, "Couldn't load the QC settings.")}
          </Note>
        )}

        {query.data && (
          <>
            <table className={`table ${styles.valueTable}`}>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className={styles.settingName}>Overdue after (days)</span>
                    <span className={styles.settingHint}>
                      An open case that’s made no progress at its current stage for longer than this is marked Overdue
                      and counts on the QC &amp; credits tab.
                    </span>
                  </td>
                  <td>
                    <input
                      className={styles.select}
                      type="number"
                      min={1}
                      max={MAX_OVERDUE_DAYS}
                      step={1}
                      inputMode="numeric"
                      value={overdueDays}
                      onChange={(e) => setOverdueDays(e.target.value)}
                      aria-label="Days before an open credit case is overdue"
                    />
                  </td>
                </tr>
                <tr>
                  <td>
                    <span className={styles.settingName}>QC Review looks back (days)</span>
                    <span className={styles.settingHint}>
                      How far back the QC Review list on the QC &amp; credits tab looks for SMRT cells the QC team failed
                      in LangQC (by the date they signed it off). Needs the MLWH connection.
                    </span>
                  </td>
                  <td>
                    <input
                      className={styles.select}
                      type="number"
                      min={1}
                      max={MAX_LOOKBACK_DAYS}
                      step={1}
                      inputMode="numeric"
                      value={lookbackDays}
                      onChange={(e) => setLookbackDays(e.target.value)}
                      aria-label="Days the QC Review list looks back"
                    />
                  </td>
                </tr>
              </tbody>
            </table>

            {!overdueValid && overdueDays.trim() !== "" && (
              <Note tone="warn" icon="!">
                Overdue after: enter a whole number of days from 1 to {MAX_OVERDUE_DAYS}.
              </Note>
            )}
            {!lookbackValid && lookbackDays.trim() !== "" && (
              <Note tone="warn" icon="!">
                QC Review looks back: enter a whole number of days from 1 to {MAX_LOOKBACK_DAYS}.
              </Note>
            )}
            {mutation.isError && (
              <Note tone="bad" icon="!">
                {errorMessage(mutation.error, "Couldn't save the QC settings.")}
              </Note>
            )}

            <div className={styles.actions}>
              {!dirty && !mutation.isPending && valid && <span className={styles.savedNote}>All changes saved</span>}
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() =>
                  mutation.mutate({ overdue_days: Number(overdueDays), review_lookback_days: Number(lookbackDays) })
                }
              >
                {mutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

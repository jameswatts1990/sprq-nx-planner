import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { errorMessage } from "@/api/client";
import { settingsApi } from "@/api/settings";
import type { IssueReportSettings } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { ISSUE_REPORT_SETTING_LABEL, unsetIssueReportSettings } from "@/utils/issueReport";

import styles from "./SettingsPanel.module.css";

type FieldKey = keyof IssueReportSettings;

/** Which report column(s) each value fills - the hint under its name. */
const FIELD_HINT: Record<FieldKey, string> = {
  team: "Fills “Team who identified the issue” and “Issue Owner”.",
  equipment_owner: "Fills “Equipment Owner” — the team that owns the instruments.",
  manager: "Fills the “Select appropriate manager or equivalent” column — who to notify.",
};

const FIELDS = Object.keys(FIELD_HINT) as FieldKey[];

/** Settings > Issue report: the lab-specific values the Generate report row fills in (see
 * utils/issueReport.buildReportFields). Blank until set - an unset value leaves its column blank
 * and the report preview says so. Mirrors CreditEmailPanel's form/dirty/save pattern. */
export function IssueReportPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["issue-report-settings"], queryFn: () => settingsApi.getIssueReport() });

  const [form, setForm] = useState<IssueReportSettings | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: IssueReportSettings) => settingsApi.updateIssueReport(body),
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(["issue-report-settings"], data);
    },
  });

  const dirty = form != null && query.data != null && FIELDS.some((k) => form[k].trim() !== query.data[k]);
  const unset = unsetIssueReportSettings(query.data);

  return (
    <Card>
      <CardHeader>
        <h2>Issue report</h2>
      </CardHeader>
      <CardBody className={styles.body}>
        <p className={styles.helper}>
          The lab-specific columns of the row <b>Generate report ▾</b> builds on a PacBio credit case, for the
          issue-tracking sheet. The rest of the row comes from the case itself.
        </p>

        {query.isError && (
          <Note tone="bad" icon="!">
            {errorMessage(query.error, "Couldn't load the issue-report settings.")}
          </Note>
        )}

        {form && (
          <>
            {unset.length > 0 && !dirty && (
              <Note tone="warn" icon="!">
                Not set: {unset.join(", ")} — those columns are left blank on every report until you fill them in.
              </Note>
            )}

            <table className={`table ${styles.valueTable}`}>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((key) => (
                  <tr key={key}>
                    <td>
                      <span className={styles.settingName}>{ISSUE_REPORT_SETTING_LABEL[key]}</span>
                      <span className={styles.settingHint}>{FIELD_HINT[key]}</span>
                    </td>
                    <td>
                      <input
                        className={styles.select}
                        type="text"
                        maxLength={120}
                        value={form[key]}
                        placeholder="Not set"
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        aria-label={ISSUE_REPORT_SETTING_LABEL[key]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {mutation.isError && (
              <Note tone="bad" icon="!">
                {errorMessage(mutation.error, "Couldn't save the issue-report settings.")}
              </Note>
            )}

            <div className={styles.actions}>
              {!dirty && !mutation.isPending && <span className={styles.savedNote}>All changes saved</span>}
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty || mutation.isPending}
                onClick={() => mutation.mutate(form)}
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

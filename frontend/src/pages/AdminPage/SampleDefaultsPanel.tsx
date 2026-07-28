import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { importsApi } from "@/api/imports";
import { settingsApi } from "@/api/settings";
import type { SampleDefaults } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";

import styles from "./SampleDefaultsPanel.module.css";

/** The four defaultable sample fields, each rendered as one row of the defaults table. The
 * three booleans share a True/False picker; priority uses the canonical priority choices. */
const BOOL_OPTIONS = ["True", "False"];
const DEFAULT_ROWS: { key: keyof SampleDefaults; label: string; hint: string }[] = [
  { key: "adaptive_loading", label: "Adaptive Loading", hint: "Default for newly added / imported samples." },
  { key: "full_resolution_base_q", label: "Full-Resolution Base Q", hint: "Default for newly added / imported samples." },
  { key: "base_kinetics", label: "Include Base Kinetics", hint: "Default for newly added / imported samples." },
  { key: "priority", label: "Priority", hint: "Applied when a sample is imported/added with no priority." },
];

/** Admin panel: set the default loading options applied to new samples. These pre-fill the
 * add-sample form and back-fill any of the four fields left blank on import. Sits at the top
 * of the Admin page. Unlike the raw table tools below, this goes through the normal
 * service-layer path (validated + audit-logged), so it's not a dev-only escape hatch. */
export function SampleDefaultsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["sample-defaults"], queryFn: () => settingsApi.getSampleDefaults() });
  // Reuse the import-fields spec purely to source the canonical priority choices, so the
  // picker can never drift from the values the backend accepts.
  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const priorityChoices = fieldsQuery.data?.find((f) => f.key === "priority")?.choices ?? [];

  const [form, setForm] = useState<SampleDefaults | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: SampleDefaults) => settingsApi.updateSampleDefaults(body),
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(["sample-defaults"], data);
    },
  });

  const dirty = form != null && query.data != null && JSON.stringify(form) !== JSON.stringify(query.data);

  function set(key: keyof SampleDefaults, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Sample defaults</h2>
        <p className={styles.helper}>
          Default loading options for new samples. These pre-fill the “Add sample” form and fill in any of these
          fields left blank when a sample is imported. Existing samples are unaffected.
        </p>
      </div>

      {query.isError && (
        <Note tone="bad" icon="!">
          {query.error instanceof ApiError ? query.error.message : "Failed to load sample defaults."}
        </Note>
      )}

      {form && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Default value</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_ROWS.map((row) => {
                const options = row.key === "priority" ? priorityChoices : BOOL_OPTIONS;
                return (
                  <tr key={row.key}>
                    <td>
                      <span className={styles.fieldLabel}>{row.label}</span>
                      <span className={styles.fieldHint}>{row.hint}</span>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={form[row.key]}
                        onChange={(e) => set(row.key, e.target.value)}
                        aria-label={`Default ${row.label}`}
                      >
                        {/* If the stored value isn't in the current option set (e.g. choices
                            still loading), keep it visible so nothing is silently dropped. */}
                        {!options.includes(form[row.key]) && (
                          <option value={form[row.key]}>{form[row.key]}</option>
                        )}
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {mutation.isError && (
            <Note tone="bad" icon="!">
              {mutation.error instanceof ApiError ? mutation.error.message : "Failed to save defaults."}
            </Note>
          )}

          <div className={styles.actions}>
            {!dirty && !mutation.isPending && <span className={styles.savedNote}>All changes saved</span>}
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || mutation.isPending}
              onClick={() => form && mutation.mutate(form)}
            >
              {mutation.isPending ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

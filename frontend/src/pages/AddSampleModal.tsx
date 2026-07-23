import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { importsApi } from "@/api/imports";
import { samplesApi } from "@/api/samples";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { SampleCreate } from "@/types/sample";

import styles from "./AddSampleModal.module.css";

/** Split a free-text list (commas/semicolons/whitespace), trim, drop blanks, de-dupe. */
function splitList(raw: string): string[] {
  const parts = raw.split(/[,;/\s]+/).map((p) => p.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

export function AddSampleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);

  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const fields = fieldsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: (body: SampleCreate) => samplesApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      onClose();
    },
  });

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function handleSubmit() {
    setClientError(null);
    const externalId = (values.external_id ?? "").trim();
    const barcodes = splitList(values.barcodes ?? "");
    if (!externalId) return setClientError("Container ID is required.");
    if (barcodes.length === 0) return setClientError("At least one barcode is required.");

    const str = (k: string) => ((values[k] ?? "").trim() ? (values[k] ?? "").trim() : null);
    const num = (k: string) => {
      const raw = (values[k] ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    mutation.mutate({
      external_id: externalId,
      barcodes,
      sanger_ids: splitList(values.sanger ?? ""),
      parent_sample: str("parent_sample"),
      target_oplc: num("target_oplc"),
      volume: num("volume"),
      adaptive_loading: str("adaptive_loading"),
      full_resolution_base_q: str("full_resolution_base_q"),
      priority: str("priority"),
      ccs_kinetics: str("ccs_kinetics"),
    });
  }

  const errorMsg =
    clientError ??
    (mutation.isError
      ? mutation.error instanceof ApiError
        ? mutation.error.message
        : "Could not add the sample."
      : null);

  return (
    <Modal onClose={onClose} title="Add sample to backlog" maxWidth={560}>
      <p className={styles.intro}>
        Add one sample by hand. It lands in the backlog just like an imported row. Container ID and at least
        one barcode are required.
      </p>

      <div className={styles.grid}>
        {fields.map((f) => (
          <label key={f.key} className={styles.field}>
            <span className={styles.label}>
              {f.label}
              {f.required && <span className={styles.req}> *</span>}
            </span>
            {f.kind === "boolean" ? (
              <select
                className={styles.input}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
              >
                <option value="">—</option>
                <option value="True">True</option>
                <option value="False">False</option>
              </select>
            ) : (
              <input
                className={styles.input}
                value={values[f.key] ?? ""}
                placeholder={f.example}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {(f.kind === "barcodes" || f.kind === "sanger") && (
              <span className={styles.hint}>Separate multiple with commas or spaces.</span>
            )}
          </label>
        ))}
      </div>

      {errorMsg && (
        <div className={styles.error}>
          <Note tone="bad" icon="!">
            {errorMsg}
          </Note>
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={mutation.isPending}>
          {mutation.isPending ? "Adding…" : "Add to backlog"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

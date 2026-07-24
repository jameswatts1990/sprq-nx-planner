import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { importsApi } from "@/api/imports";
import { samplesApi } from "@/api/samples";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { SampleCreate, SampleOut, SampleUpdate } from "@/types/sample";

import styles from "./SampleModal.module.css";

/** Form-field keys that identify the sample and stay read-only when editing (see the
 * import-field spec for the key names). Container ID is the sample's fixed identity. */
const PROTECTED_KEYS = new Set(["external_id"]);

/** Split a free-text list (commas/semicolons/whitespace), trim, drop blanks, de-dupe. */
function splitList(raw: string): string[] {
  const parts = raw.split(/[,;/\s]+/).map((p) => p.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

/** Seed the form from an existing sample (edit mode). Keys mirror the importable-field
 * spec — note the Sanger IDs field's key is `sanger`, not `sanger_ids`. */
function valuesFromSample(sample: SampleOut): Record<string, string> {
  return {
    external_id: sample.external_id,
    barcodes: sample.barcodes.join(", "),
    sanger: sample.sanger_ids.join(", "),
    parent_sample: sample.parent_sample ?? "",
    target_oplc: sample.target_oplc != null ? String(sample.target_oplc) : "",
    volume: sample.volume != null ? String(sample.volume) : "",
    adaptive_loading: sample.adaptive_loading ?? "",
    full_resolution_base_q: sample.full_resolution_base_q ?? "",
    priority: sample.priority ?? "",
    ccs_kinetics: sample.ccs_kinetics ?? "",
  };
}

/** Add a new backlog sample, or (when `sample` is given) edit an existing one. Same form
 * either way; in edit mode the Container ID is greyed out because a sample's identity is
 * fixed once created. */
export function SampleModal({ sample, onClose }: { sample?: SampleOut; onClose: () => void }) {
  const isEdit = sample != null;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    sample ? valuesFromSample(sample) : {},
  );
  const [clientError, setClientError] = useState<string | null>(null);

  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const fields = fieldsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: (body: SampleCreate | SampleUpdate) =>
      sample ? samplesApi.update(sample.id, body) : samplesApi.create(body as SampleCreate),
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
    if (!isEdit && !externalId) return setClientError("Container ID is required.");
    if (barcodes.length === 0) return setClientError("At least one barcode is required.");

    const str = (k: string) => ((values[k] ?? "").trim() ? (values[k] ?? "").trim() : null);
    const num = (k: string) => {
      const raw = (values[k] ?? "").trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    const editable: SampleUpdate = {
      barcodes,
      sanger_ids: splitList(values.sanger ?? ""),
      parent_sample: str("parent_sample"),
      target_oplc: num("target_oplc"),
      volume: num("volume"),
      adaptive_loading: str("adaptive_loading"),
      full_resolution_base_q: str("full_resolution_base_q"),
      priority: str("priority"),
      ccs_kinetics: str("ccs_kinetics"),
    };

    mutation.mutate(isEdit ? editable : { external_id: externalId, ...editable });
  }

  const errorMsg =
    clientError ??
    (mutation.isError
      ? mutation.error instanceof ApiError
        ? mutation.error.message
        : isEdit
          ? "Could not save the sample."
          : "Could not add the sample."
      : null);

  return (
    <Modal
      onClose={onClose}
      title={isEdit ? "Edit backlog sample" : "Add sample to backlog"}
      maxWidth={560}
    >
      <p className={styles.intro}>
        {isEdit ? (
          <>
            Update this backlog sample. The Container ID identifies the sample and can&apos;t be
            changed; at least one barcode is still required.
          </>
        ) : (
          <>
            Add one sample by hand. It lands in the backlog just like an imported row. Container ID
            and at least one barcode are required.
          </>
        )}
      </p>

      <div className={styles.grid}>
        {fields.map((f) => {
          const locked = isEdit && PROTECTED_KEYS.has(f.key);
          return (
            <label key={f.key} className={styles.field}>
              <span className={styles.label}>
                {f.label}
                {f.required && <span className={styles.req}> *</span>}
                {locked && <span className={styles.lock}> · locked</span>}
              </span>
              {f.kind === "boolean" ? (
                <select
                  className={styles.input}
                  value={values[f.key] ?? ""}
                  disabled={locked}
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
                  disabled={locked}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {locked ? (
                <span className={styles.hint}>The sample&apos;s identity — fixed once created.</span>
              ) : (
                (f.kind === "barcodes" || f.kind === "sanger") && (
                  <span className={styles.hint}>Separate multiple with commas or spaces.</span>
                )
              )}
            </label>
          );
        })}
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
          {isEdit
            ? mutation.isPending
              ? "Saving…"
              : "Save changes"
            : mutation.isPending
              ? "Adding…"
              : "Add to backlog"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { importsApi } from "@/api/imports";
import { samplesApi } from "@/api/samples";
import { settingsApi } from "@/api/settings";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { Note } from "@/components/ui/Note";
import type { ImportField } from "@/types/importing";
import type { SampleCreate, SampleOut, SampleUpdate } from "@/types/sample";

import styles from "./SampleModal.module.css";

/** Form-field keys that identify the sample and stay read-only when editing (see the
 * import-field spec for the key names). Container ID is the sample's fixed identity. */
const PROTECTED_KEYS = new Set(["external_id"]);

/** The form's fixed layout: shaded sections, each a stack of two-column rows referencing
 * field keys. This drives the grouped presentation instead of one flat field grid; the
 * per-field metadata (label/kind/choices) still comes from the backend import-field spec.
 * Every optional and required field appears exactly once. */
const SECTIONS: { header: string; rows: [string, string][] }[] = [
  {
    header: "Sample ID & Priority",
    rows: [
      ["external_id", "priority"],
      ["sanger", "parent_sample"],
    ],
  },
  {
    header: "Complex Details",
    rows: [
      ["barcodes", "insert_size_bp"],
      ["target_oplc", "actual_oplc"],
      ["cleaned_complex_volume", "loading_buffer_volume"],
    ],
  },
  {
    header: "Run Settings",
    rows: [
      ["adaptive_loading", "movie_time_hours"],
      ["full_resolution_base_q", "base_kinetics"],
    ],
  },
];

/** Field-label overrides shown on the form only — the backend spec keeps the canonical
 * labels (used on import/template). These reword a couple of identifiers for lab users. */
const LABEL_OVERRIDES: Record<string, string> = {
  external_id: "Unique ID e.g. Pool ID",
  parent_sample: "Parent Sample e.g. Plate ID",
};

// Loading buffer is a derived volume, not a free input: Complex + Loading buffer always tops
// up to this fixed total (µL), so Loading buffer defaults to 25 − Cleaned Complex Vol. The
// user can still override it, but an off-target override shows a persistent warning.
const LOADING_TOTAL_UL = 25;
const K_COMPLEX = "cleaned_complex_volume";
const K_LOADING_BUFFER = "loading_buffer_volume";

/** The Loading buffer volume that keeps Complex + Loading buffer = 25 µL, given the current
 * Cleaned Complex Vol input. Returns null when complex is blank/non-numeric (nothing to
 * derive from). Rounded to shed binary-float noise (e.g. 25 − 8.1). */
function expectedLoadingBuffer(complexRaw: string): number | null {
  const raw = complexRaw.trim();
  if (!raw) return null;
  const c = Number(raw);
  if (!Number.isFinite(c)) return null;
  return Number((LOADING_TOTAL_UL - c).toFixed(2));
}

/** The shape of the 409 body the create endpoint returns for a seen-before Container ID. */
type DuplicateDetail = { detail: { code: "duplicate_container"; message: string; seen_count: number } };
function isDuplicateDetail(body: unknown): body is DuplicateDetail {
  return (
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    typeof (body as { detail: unknown }).detail === "object" &&
    (body as { detail: { code?: unknown } }).detail?.code === "duplicate_container"
  );
}

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
    actual_oplc: sample.actual_oplc != null ? String(sample.actual_oplc) : "",
    cleaned_complex_volume:
      sample.cleaned_complex_volume != null ? String(sample.cleaned_complex_volume) : "",
    loading_buffer_volume:
      sample.loading_buffer_volume != null ? String(sample.loading_buffer_volume) : "",
    adaptive_loading: sample.adaptive_loading ?? "",
    full_resolution_base_q: sample.full_resolution_base_q ?? "",
    priority: sample.priority ?? "",
    base_kinetics: sample.base_kinetics ?? "",
    movie_time_hours: sample.movie_time_hours != null ? String(sample.movie_time_hours) : "",
    insert_size_bp: sample.insert_size_bp != null ? String(sample.insert_size_bp) : "",
  };
}

/** Add a new backlog sample, or (when `sample` is given) edit an existing one. Same form
 * either way; in edit mode the Container ID is greyed out because a sample's identity is
 * fixed once created.
 *
 * `editableKeys` puts the form into restricted mode: only fields whose key is in the set
 * are shown as editable (the Container ID is still shown, locked, for context; every other
 * field is hidden). The Schedule page's slot-detail popover uses this to edit an
 * already-placed sample's loading parameters only — its barcodes/Sanger/parent are frozen
 * once scheduled (the backend ignores them for a placed sample regardless), so exposing
 * them here would just invite edits that silently don't apply.
 *
 * `onSaved` runs after a successful save, before onClose — a hook for callers that need to
 * refresh more than the ["samples"] list this modal already invalidates (e.g. the popover
 * refreshing the schedule grid it lives on). */
export function SampleModal({
  sample,
  editableKeys,
  onClose,
  onSaved,
}: {
  sample?: SampleOut;
  editableKeys?: Set<string>;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const isEdit = sample != null;
  const isRestricted = editableKeys != null;
  const isAdd = !isEdit && !isRestricted;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    sample ? valuesFromSample(sample) : {},
  );
  // Whether Loading buffer is still tracking the derived 25 − complex default (vs. a manual
  // override). Auto while a fresh add hasn't been touched, or when an existing sample's stored
  // buffer already matches the derived value; flipped off the moment the user edits it by hand.
  const [lbAuto, setLbAuto] = useState<boolean>(() => {
    if (!sample) return true;
    if (sample.loading_buffer_volume == null) return true;
    const exp = expectedLoadingBuffer(String(sample.cleaned_complex_volume ?? ""));
    return exp != null && Number(sample.loading_buffer_volume) === exp;
  });
  const [clientError, setClientError] = useState<string | null>(null);
  // Set when a create hits the duplicate-container 409: holds the "seen N times" prompt so the
  // form can offer an "Add anyway" confirm instead of a dead-end error.
  const [duplicatePrompt, setDuplicatePrompt] = useState<string | null>(null);
  const pendingBodyRef = useRef<SampleCreate | null>(null);

  const fieldsQuery = useQuery({ queryKey: ["import-fields"], queryFn: () => importsApi.fields() });
  const fields = fieldsQuery.data ?? [];

  // On a fresh "Add to backlog", pre-fill the four defaultable loading options from the
  // admin-configured sample defaults so the user sees them before saving (they can still
  // change any of them). Only seeds once, and never overrides something the user typed first.
  const defaultsQuery = useQuery({
    queryKey: ["sample-defaults"],
    queryFn: () => settingsApi.getSampleDefaults(),
    enabled: isAdd,
  });
  const seededRef = useRef(false);
  useEffect(() => {
    if (isAdd && !seededRef.current && defaultsQuery.data) {
      seededRef.current = true;
      const d = defaultsQuery.data;
      setValues((prev) => ({
        adaptive_loading: d.adaptive_loading,
        full_resolution_base_q: d.full_resolution_base_q,
        base_kinetics: d.base_kinetics,
        priority: d.priority,
        ...prev, // anything the user already typed wins
      }));
    }
  }, [isAdd, defaultsQuery.data]);

  const mutation = useMutation({
    mutationFn: ({ body, allowDuplicate }: { body: SampleCreate | SampleUpdate; allowDuplicate?: boolean }) =>
      sample
        ? samplesApi.update(sample.id, body)
        : samplesApi.create(body as SampleCreate, allowDuplicate ?? false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["samples"] });
      onSaved?.();
      onClose();
    },
    onError: (err) => {
      // A duplicate Container ID isn't a hard error — it's a confirm. Capture the "seen N times"
      // message so handleSubmit can offer "Add anyway" (re-submit with allowDuplicate).
      if (err instanceof ApiError && err.status === 409 && isDuplicateDetail(err.body)) {
        setDuplicatePrompt(err.body.detail.message);
      }
    },
  });

  function set(key: string, v: string) {
    // Editing the Container ID invalidates a pending duplicate confirm — the ID it warned about
    // no longer matches, so drop back to a normal submit rather than "Add anyway" on a stale body.
    if (key === "external_id" && duplicatePrompt) setDuplicatePrompt(null);
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      // Keep Loading buffer topped up to 25 − complex while it's still auto-derived. Editing
      // complex re-derives it; editing complex to blank clears the derived buffer too.
      if (key === K_COMPLEX && lbAuto) {
        const exp = expectedLoadingBuffer(v);
        next[K_LOADING_BUFFER] = exp != null ? String(exp) : "";
      }
      return next;
    });
    // A hand-edit to Loading buffer detaches it from the derived default (persistent warning
    // then flags any off-target value until it's reset).
    if (key === K_LOADING_BUFFER) setLbAuto(false);
  }

  /** Restore Loading buffer to the derived 25 − complex default and resume auto-tracking. */
  function resetLoadingBuffer() {
    const exp = expectedLoadingBuffer(values[K_COMPLEX] ?? "");
    setValues((prev) => ({ ...prev, [K_LOADING_BUFFER]: exp != null ? String(exp) : "" }));
    setLbAuto(true);
  }

  // Derived off-target check for the persistent Loading buffer warning.
  const lbExpected = expectedLoadingBuffer(values[K_COMPLEX] ?? "");
  const lbRaw = (values[K_LOADING_BUFFER] ?? "").trim();
  const lbNum = Number(lbRaw);
  const lbOffTarget =
    lbExpected != null && lbRaw !== "" && Number.isFinite(lbNum) && lbNum !== lbExpected;

  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));

  /** Whether a field is shown on the form: import-only fields are never hand-editable, and in
   * restricted (placed-sample) mode only the editable fields plus the locked Container ID show. */
  function isVisible(f: ImportField | undefined): f is ImportField {
    if (!f || f.import_only) return false;
    return !isRestricted || editableKeys.has(f.key) || PROTECTED_KEYS.has(f.key);
  }

  /** One field cell (label + input/select). The loading-buffer off-target warning is rendered
   * separately at row level so it can span the full width rather than one narrow column. */
  function renderField(f: ImportField) {
    const locked = (isEdit && PROTECTED_KEYS.has(f.key)) || (isRestricted && !editableKeys.has(f.key));
    const isLoadingBuffer = f.key === K_LOADING_BUFFER;
    return (
      <label key={f.key} className={styles.field}>
        <span className={styles.label}>
          {LABEL_OVERRIDES[f.key] ?? f.label}
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
        ) : f.kind === "select" ? (
          <select
            className={styles.input}
            value={values[f.key] ?? ""}
            disabled={locked}
            onChange={(e) => set(f.key, e.target.value)}
          >
            <option value="">—</option>
            {(f.choices ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={styles.input}
            value={values[f.key] ?? ""}
            placeholder={f.example}
            inputMode={f.kind === "number" ? "decimal" : undefined}
            disabled={locked}
            title={
              isLoadingBuffer
                ? `Auto-calculated as ${LOADING_TOTAL_UL} − Cleaned Complex Vol · Complex + Loading buffer = ${LOADING_TOTAL_UL} µL. Override if needed.`
                : undefined
            }
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
  }

  function handleSubmit() {
    setClientError(null);
    setDuplicatePrompt(null);
    const externalId = (values.external_id ?? "").trim();
    const barcodes = splitList(values.barcodes ?? "");
    if (!isEdit && !externalId) return setClientError("Container ID is required.");
    // In restricted (placed-sample) mode barcodes aren't editable and the backend ignores
    // them, so don't block on them — the seeded set is sent unchanged just to satisfy the
    // shared request shape.
    if (!isRestricted && barcodes.length === 0) return setClientError("At least one barcode is required.");

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
      actual_oplc: num("actual_oplc"),
      cleaned_complex_volume: num("cleaned_complex_volume"),
      loading_buffer_volume: num("loading_buffer_volume"),
      adaptive_loading: str("adaptive_loading"),
      full_resolution_base_q: str("full_resolution_base_q"),
      priority: str("priority"),
      base_kinetics: str("base_kinetics"),
      movie_time_hours: num("movie_time_hours"),
      insert_size_bp: num("insert_size_bp"),
    };

    if (isEdit) {
      mutation.mutate({ body: editable });
      return;
    }
    const createBody: SampleCreate = { external_id: externalId, ...editable };
    pendingBodyRef.current = createBody;
    mutation.mutate({ body: createBody });
  }

  /** Re-submit the just-attempted create, this time confirming the duplicate. */
  function confirmDuplicate() {
    if (!pendingBodyRef.current) return;
    setDuplicatePrompt(null);
    mutation.mutate({ body: pendingBodyRef.current, allowDuplicate: true });
  }

  // A duplicate 409 is handled by the confirm banner, not the generic error line.
  const errorMsg =
    duplicatePrompt != null
      ? null
      : clientError ??
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
      title={isRestricted ? "Edit scheduled sample" : isEdit ? "Edit backlog sample" : "Add sample to backlog"}
      maxWidth={560}
    >
      <p className={styles.intro}>
        {isRestricted ? (
          <>
            This sample is already scheduled. Its barcodes and identity are locked once it&apos;s placed on
            the grid — you can still adjust its loading parameters below.
          </>
        ) : isEdit ? (
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

      <div className={styles.sections}>
        {SECTIONS.map((section) => {
          const visibleRows = section.rows
            .map((keys) => keys.map((k) => fieldsByKey.get(k)).filter(isVisible) as ImportField[])
            .filter((row) => row.length > 0);
          // In restricted (placed-sample) mode a whole section can end up empty — drop it and
          // its header rather than render a bare heading.
          if (visibleRows.length === 0) return null;
          return (
            <section key={section.header} className={styles.section}>
              <h3 className={styles.sectionHeader}>{section.header}</h3>
              <div className={styles.rows}>
                {visibleRows.map((row, i) => {
                  const hasLbWarn = row.some((f) => f.key === K_LOADING_BUFFER) && lbOffTarget;
                  return (
                    <div key={i} className={styles.row}>
                      {row.map(renderField)}
                      {hasLbWarn && (
                        <div className={styles.rowWarn}>
                          <Note tone="warn" icon="!">
                            Loading buffer is {lbNum} µL, {lbNum > (lbExpected as number) ? "above" : "below"} the{" "}
                            {lbExpected} µL that keeps Complex + Loading buffer = {LOADING_TOTAL_UL} µL.{" "}
                            <button type="button" className={styles.lbReset} onClick={resetLoadingBuffer}>
                              Use {lbExpected} µL
                            </button>
                          </Note>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
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

      {duplicatePrompt && (
        <div className={styles.error}>
          <Note tone="warn" icon="!">
            {duplicatePrompt} Duplicates are allowed — the same sample can be run across multiple cells.
          </Note>
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        {duplicatePrompt ? (
          <Button variant="primary" onClick={confirmDuplicate} disabled={mutation.isPending}>
            {mutation.isPending ? "Adding…" : "Add anyway"}
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit} disabled={mutation.isPending}>
            {isEdit
              ? mutation.isPending
                ? "Saving…"
                : "Save changes"
              : mutation.isPending
                ? "Adding…"
                : "Add to backlog"}
          </Button>
        )}
      </ModalActions>
    </Modal>
  );
}

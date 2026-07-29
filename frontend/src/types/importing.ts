import type { SampleOut } from "./sample";

export interface ImportRequest {
  raw_text: string;
  filename?: string | null;
  actor?: string | null;
  /** Field-key -> column-index map confirmed in the review wizard. */
  column_map?: Record<string, number>;
  /** Whether row 0 is a header (stripped) or data. Only used on the column_map path. */
  has_header?: boolean;
}

export interface RejectedRow {
  external_id: string;
  reason: string;
}

export interface SkippedRow {
  identifier: string;
  reason: string;
}

/** A Container ID this import created more than one copy of, and/or that was already known
 * (any status, incl. completed). Surfaced as a heads-up (with an Undo recommendation), not a
 * rejection — duplicates are a supported workflow. */
export interface DuplicateNote {
  external_id: string;
  /** Copies created by this import. */
  created_now: number;
  /** Total samples carrying this Container ID now (prior + this import). */
  total_seen: number;
}

export interface ImportResult {
  import_batch_id: number;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  /** How many imported rows share a Container ID with another sample (heads-up count). */
  duplicate_count: number;
  warnings: string[];
  rejected: RejectedRow[];
  skipped: SkippedRow[];
  /** Per-Container-ID duplicate summary (only IDs seen more than once). */
  duplicates: DuplicateNote[];
  samples: SampleOut[];
}

/** One canonical importable field (target of the mapping UI + the add-sample form). */
export interface ImportField {
  key: string;
  label: string;
  kind: "text" | "number" | "barcodes" | "sanger" | "boolean" | "select";
  required: boolean;
  example: string;
  /** For kind="select": the fixed set of accepted values, rendered as a dropdown on the
   * manual add/edit form (empty for every other field kind). */
  choices?: string[];
  /** True for fields that can be mapped/imported but aren't offered on the manual add/edit
   * form (value comes in via import only, shown only on the batch sheet). */
  import_only?: boolean;
}

export interface PreviewColumn {
  index: number;
  name: string;
}

export interface ImportPreviewRequest {
  raw_text: string;
  has_header: boolean;
}

export interface ImportPreviewResult {
  has_header: boolean;
  columns: PreviewColumn[];
  suggested_map: Record<string, number>;
  sample_rows: string[][];
  row_count: number;
  unmatched_required: string[];
  /** Container IDs that repeat within the pasted file (best-effort, from the auto-suggested ID
   * column), so the mapping-review step can warn before committing. */
  within_file_duplicates: DuplicateNote[];
}

/** Convert a scheduler sheet (as CSV text) into the standard import CSV by pooling rows. */
export interface SchedulerConvertRequest {
  raw_text: string;
}

export interface SchedulerConvertResult {
  /** A standard import CSV (canonical headers) ready for the normal preview/mapping flow. */
  csv: string;
  /** Rows read from the sheet (header excluded). */
  source_row_count: number;
  /** Completed SMRT-cell pools turned into container rows. */
  pool_count: number;
  warnings: string[];
}

export interface ImportBatchOut {
  id: number;
  created_at: string;
  created_by: string;
  source_filename: string | null;
  header_detected: boolean;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  duplicate_count: number;
  warnings: string[];
}

/** The most recent import batch + whether it can still be undone (drives the Import banner). */
export interface LatestImport {
  id: number;
  created_at: string;
  created_by: string;
  source_filename: string | null;
  row_count: number;
  imported_count: number;
  undoable: boolean;
  /** Why undo is unavailable (samples progressed/edited, or a newer import exists); null when undoable. */
  undo_block_reason: string | null;
  /** How many of the batch's samples are no longer pristine. */
  blocking_count: number;
}

export interface UndoImportResult {
  import_batch_id: number;
  removed_count: number;
}

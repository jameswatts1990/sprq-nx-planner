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
  pool_id: string;
  reason: string;
}

export interface SkippedRow {
  identifier: string;
  reason: string;
}

/** A Pool ID this import created more than one copy of, and/or that was already known
 * (any status, incl. completed). Surfaced as a heads-up (with an Undo recommendation), not a
 * rejection — duplicates are a supported workflow. */
export interface DuplicateNote {
  pool_id: string;
  /** Copies created by this import. */
  created_now: number;
  /** Total samples carrying this Pool ID now (prior + this import). */
  total_seen: number;
}

export interface ImportResult {
  import_batch_id: number;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  /** How many imported rows share a Pool ID with another sample (heads-up count). */
  duplicate_count: number;
  warnings: string[];
  rejected: RejectedRow[];
  skipped: SkippedRow[];
  /** Per-Pool ID duplicate summary (only IDs seen more than once). */
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
  /** Pool IDs that repeat within the pasted file (best-effort, from the auto-suggested ID
   * column), so the mapping-review step can warn before committing. */
  within_file_duplicates: DuplicateNote[];
}

/** Convert a scheduler sheet (as CSV text) into the standard import CSV by pooling rows. */
export interface SchedulerConvertRequest {
  raw_text: string;
}

/** One source row inside a pool, for the review breakdown ("3 samples at 33%"). */
export interface SchedulerPoolMember {
  label: string;
  portion_percent: number;
}

/** A pool (one SMRT Cell) formed by grouping scheduler rows on Pool ID. `row` is the collapsed,
 * importable line aligned to SchedulerConvertResult.columns; `status` is "ok" (a whole cell,
 * auto-included) or "review" (portions don't add up to a whole cell — needs authorising). */
export interface SchedulerPool {
  pool_id: string;
  status: "ok" | "review";
  portion_percent: number;
  note: string | null;
  members: SchedulerPoolMember[];
  row: string[];
}

export interface SchedulerConvertResult {
  /** Original scheduler headers (the Portion column removed); the UI builds the import CSV from
   * these + the authorised pools' rows. */
  columns: string[];
  /** Pools formed by Pool ID, index-aligned to the CSV rows the UI builds. */
  pools: SchedulerPool[];
  /** Rows read from the sheet (header excluded). */
  source_row_count: number;
  /** Pools formed (all statuses). */
  pool_count: number;
  /** Pools needing authorisation. */
  review_count: number;
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

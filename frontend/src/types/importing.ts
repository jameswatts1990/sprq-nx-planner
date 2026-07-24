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

export interface ImportResult {
  import_batch_id: number;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  duplicate_count: number;
  warnings: string[];
  rejected: RejectedRow[];
  skipped: SkippedRow[];
  samples: SampleOut[];
}

/** One canonical importable field (target of the mapping UI + the add-sample form). */
export interface ImportField {
  key: string;
  label: string;
  kind: "text" | "number" | "barcodes" | "sanger" | "boolean";
  required: boolean;
  example: string;
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

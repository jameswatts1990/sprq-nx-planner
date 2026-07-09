import type { SampleOut } from "./sample";

export interface ImportRequest {
  raw_text: string;
  filename?: string | null;
  actor?: string | null;
}

export interface RejectedRow {
  external_id: string;
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
  samples: SampleOut[];
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

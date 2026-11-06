export interface TableInfo {
  name: string;
  columns: string[];
  primary_key: string[];
  row_count: number;
}

export interface RowPage {
  table: string;
  columns: string[];
  primary_key: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  page_size: number;
}

export interface ClearResult {
  table: string;
  deleted: number;
}

export interface ClearBacklogResult {
  deleted: number;
}

export interface MlwhProbeRequest {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
}

export interface MlwhTable {
  name: string;
  /** InnoDB's cached estimate (null for views), not an exact count. */
  approx_rows: number | null;
}

export interface MlwhProbeResult {
  ok: boolean;
  /** user@host:port/database - never includes the password. */
  target: string;
  /** Connect + both queries. */
  elapsed_ms: number | null;
  server_version: string | null;
  tables: MlwhTable[];
  error: string | null;
}

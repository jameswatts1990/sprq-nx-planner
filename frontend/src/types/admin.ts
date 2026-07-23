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

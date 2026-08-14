import readXlsxFile from "read-excel-file/browser";

import { csvCell } from "./toCsv";

const XLSX_RE = /\.xlsx$/i;

/**
 * Read an uploaded scheduler file into CSV text the backend can parse.
 *
 * - `.xlsx` is parsed in the browser (first worksheet) and re-serialised to CSV, so the
 *   rest of the import pipeline only ever deals with CSV text.
 * - `.csv` / `.tsv` / `.txt` are read as-is.
 */
export async function readSpreadsheetFile(file: File): Promise<string> {
  if (XLSX_RE.test(file.name)) {
    const sheets = await readXlsxFile(file);
    return rowsToCsv(sheets[0]?.data ?? []);
  }
  return file.text();
}

function rowsToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

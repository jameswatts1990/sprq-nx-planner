import readXlsxFile from "read-excel-file/browser";

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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Date cells are rare in the columns we read, but normalise them predictably.
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

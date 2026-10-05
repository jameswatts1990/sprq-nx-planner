/**
 * Serialise a header row + data rows into CSV text the backend's `parse_csv` reads back
 * losslessly. Shared by the scheduler xlsx→CSV reader and the pool-review assembly on the
 * Import page (which rebuilds the import CSV from the pools the user authorised).
 */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Force a spreadsheet to read a value as text, not a live formula: any field starting with a
 * formula lead-in (= + - @, or a tab/CR) is prefixed with a single quote. For files a person opens
 * in Excel (the issue report, the QC export) whose values are user/record-controlled - defeats CSV
 * formula injection. Not for the import round-trip, which must stay lossless. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One CSV cell: quote + escape only when the value contains a quote, comma, or newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Date cells are rare in the columns we read, but normalise them predictably.
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Hand the user a CSV file to save (the issue report, the QC export). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

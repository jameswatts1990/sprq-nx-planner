/**
 * Serialise a header row + data rows into CSV text the backend's `parse_csv` reads back
 * losslessly. Shared by the scheduler xlsx→CSV reader and the pool-review assembly on the
 * Import page (which rebuilds the import CSV from the pools the user authorised).
 */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** One CSV cell: quote + escape only when the value contains a quote, comma, or newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Date cells are rare in the columns we read, but normalise them predictably.
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

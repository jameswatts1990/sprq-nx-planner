/** Split a barcodes cell the way the server does (backend engine/csv_parse._BARCODE_SPLIT_RE):
 * on commas, semicolons, slashes and whitespace. Repeats are kept - see repeatedBarcodes. */
export function splitBarcodes(raw: string): string[] {
  return raw
    .split(/[,;/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Barcodes listed more than once in this cell, in first-seen order. The server stores one copy,
 * so the import preview warns about them rather than dropping them silently. */
export function repeatedBarcodes(raw: string): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const bc of splitBarcodes(raw)) {
    if (seen.has(bc) && !repeated.includes(bc)) repeated.push(bc);
    seen.add(bc);
  }
  return repeated;
}
